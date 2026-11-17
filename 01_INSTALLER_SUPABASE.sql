-- Mon Scanner Pro V12 — installer dans Supabase SQL Editor.
-- Ne supprime aucune table existante. Ne pas exécuter avant sauvegarde.
create table if not exists public.hr_employees (
 id bigint generated always as identity primary key,
 user_id uuid unique references auth.users(id) on delete set null,
 full_name text not null check(length(trim(full_name))>0),
 hired_on date,
 base_salary numeric(12,3) not null default 0 check(base_salary>=0),
 created_at timestamptz not null default now()
);
create table if not exists public.hr_attendance (
 id bigint generated always as identity primary key,
 employee_id bigint not null references public.hr_employees(id),
 kind text not null check(kind in ('arrival','departure')),
 requested_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 decided_at timestamptz,
 decided_by uuid references auth.users(id)
);
create table if not exists public.hr_advances (
 id bigint generated always as identity primary key,
 employee_id bigint not null references public.hr_employees(id),
 amount numeric(12,3) not null check(amount>0),
 advanced_on date not null,
 created_at timestamptz not null default now()
);
create table if not exists public.hr_absences (
 id bigint generated always as identity primary key,
 employee_id bigint not null references public.hr_employees(id),
 absence_on date not null,
 portion text not null check(portion in ('full','half')),
 reason text not null check(length(trim(reason))>=2),
 created_at timestamptz not null default now(),
 unique(employee_id,absence_on)
);
create table if not exists public.hr_payslips (
 id bigint generated always as identity primary key,
 employee_id bigint not null references public.hr_employees(id),
 month date not null check(extract(day from month)=1),
 base_salary numeric(12,3) not null check(base_salary>=0),
 prime numeric(12,3) not null default 0 check(prime>=0),
 advances_total numeric(12,3) not null default 0,
 absence_deduction numeric(12,3) not null default 0,
 net_amount numeric(12,3) not null check(net_amount>=0),
 status text not null default 'draft' check(status in ('draft','paid')),
 payment_id bigint unique references public.salary_payments(id),
 paid_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(employee_id,month)
);
create table if not exists public.hr_push_subscriptions (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 subscription jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists hr_attendance_status_idx on public.hr_attendance(status,requested_at desc);
create index if not exists hr_attendance_employee_idx on public.hr_attendance(employee_id,requested_at desc);
create index if not exists hr_advance_employee_date_idx on public.hr_advances(employee_id,advanced_on);
create index if not exists hr_absence_employee_date_idx on public.hr_absences(employee_id,absence_on);

create or replace function public.hr_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_profiles where user_id=(select auth.uid()) and role='admin');
$$;
revoke all on function public.hr_is_admin() from public;
grant execute on function public.hr_is_admin() to authenticated;

alter table public.hr_employees enable row level security;
alter table public.hr_attendance enable row level security;
alter table public.hr_advances enable row level security;
alter table public.hr_absences enable row level security;
alter table public.hr_payslips enable row level security;
alter table public.hr_push_subscriptions enable row level security;

create policy "hr_employee_admin" on public.hr_employees for all to authenticated using(public.hr_is_admin()) with check(public.hr_is_admin());
create policy "hr_employee_self_read" on public.hr_employees for select to authenticated using(user_id=(select auth.uid()));
create policy "hr_attendance_admin_read" on public.hr_attendance for select to authenticated using(public.hr_is_admin());
create policy "hr_attendance_self_read" on public.hr_attendance for select to authenticated using(exists(select 1 from public.hr_employees e where e.id=employee_id and e.user_id=(select auth.uid())));
create policy "hr_advances_admin" on public.hr_advances for all to authenticated using(public.hr_is_admin()) with check(public.hr_is_admin());
create policy "hr_absences_admin" on public.hr_absences for all to authenticated using(public.hr_is_admin()) with check(public.hr_is_admin());
create policy "hr_payslips_admin_read" on public.hr_payslips for select to authenticated using(public.hr_is_admin());
create policy "hr_push_admin" on public.hr_push_subscriptions for all to authenticated using(public.hr_is_admin() and user_id=(select auth.uid())) with check(public.hr_is_admin() and user_id=(select auth.uid()));

-- Employee never writes timestamps or approvals. Only RPC can create pointage.
create or replace function public.hr_request_attendance(p_kind text) returns bigint
language plpgsql security definer set search_path='' as $$
declare v_employee bigint; v_id bigint; v_last record;
begin
 if auth.uid() is null then raise exception 'Connexion requise'; end if;
 if p_kind not in ('arrival','departure') then raise exception 'Type invalide'; end if;
 select id into v_employee from public.hr_employees where user_id=auth.uid();
 if v_employee is null then raise exception 'Profil employé non lié au compte'; end if;
 perform pg_advisory_xact_lock(11020,v_employee::integer);
 select kind,status into v_last from public.hr_attendance where employee_id=v_employee order by id desc limit 1;
 if v_last.status='pending' then raise exception 'Une demande est déjà en attente'; end if;
 if v_last.status='approved' and v_last.kind=p_kind then raise exception 'Pointage déjà confirmé pour ce sens'; end if;
 if v_last.status='rejected' and v_last.kind<>p_kind then raise exception 'Refaites d’abord la demande précédente'; end if;
 if v_last.kind is null and p_kind='departure' then raise exception 'Commencez par une arrivée'; end if;
 insert into public.hr_attendance(employee_id,kind) values(v_employee,p_kind) returning id into v_id;
 return v_id;
end;$$;

create or replace function public.hr_decide_attendance(p_id bigint,p_approve boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.hr_is_admin() then raise exception 'Administrateur requis'; end if;
 update public.hr_attendance set status=case when p_approve then 'approved' else 'rejected' end,
 decided_at=now(),decided_by=auth.uid() where id=p_id and status='pending';
 if not found then raise exception 'Demande introuvable ou déjà traitée'; end if;
end;$$;

create or replace function public.hr_prepare_payslip(p_employee_id bigint,p_month date,p_prime numeric) returns bigint
language plpgsql security definer set search_path='' as $$
declare v_base numeric;v_adv numeric;v_deduct numeric;v_net numeric;v_id bigint;
begin
 if not public.hr_is_admin() then raise exception 'Administrateur requis'; end if;
 if p_month is null or extract(day from p_month)<>1 or p_prime is null or p_prime<0 then raise exception 'Mois ou prime invalide'; end if;
 select base_salary into v_base from public.hr_employees where id=p_employee_id for update;
 if v_base is null then raise exception 'Employé introuvable'; end if;
 select coalesce(sum(amount),0) into v_adv from public.hr_advances where employee_id=p_employee_id and advanced_on>=p_month and advanced_on<(p_month+interval '1 month')::date;
 select coalesce(sum(case when portion='full' then v_base/30 else v_base/60 end),0) into v_deduct from public.hr_absences where employee_id=p_employee_id and absence_on>=p_month and absence_on<(p_month+interval '1 month')::date;
 v_net=round(v_base+p_prime-v_adv-v_deduct,3);
 if v_net<0 then raise exception 'Net négatif : corriger avances / absences'; end if;
 insert into public.hr_payslips(employee_id,month,base_salary,prime,advances_total,absence_deduction,net_amount)
 values(p_employee_id,p_month,v_base,p_prime,v_adv,round(v_deduct,3),v_net)
 on conflict(employee_id,month) do update set base_salary=excluded.base_salary,prime=excluded.prime,advances_total=excluded.advances_total,absence_deduction=excluded.absence_deduction,net_amount=excluded.net_amount,updated_at=now()
 where public.hr_payslips.status='draft'
 returning id into v_id;
 if v_id is null then raise exception 'Fiche déjà payée et verrouillée'; end if;
 return v_id;
end;$$;

-- Atomic: exactly one salary_payments row per payslip. Existing finance reports count it once.
create or replace function public.hr_pay_payslip(p_id bigint) returns bigint
language plpgsql security definer set search_path='' as $$
declare v_f record;v_payment bigint;v_name text;
begin
 if not public.hr_is_admin() then raise exception 'Administrateur requis'; end if;
 select * into v_f from public.hr_payslips where id=p_id for update;
 if not found then raise exception 'Fiche introuvable'; end if;
 if v_f.status='paid' then raise exception 'Fiche déjà payée'; end if;
 select full_name into v_name from public.hr_employees where id=v_f.employee_id;
 -- Date de paiement réelle, non date du mois travaillé.
 insert into public.salary_payments(employee_name,amount,paid_on) values(v_name,v_f.net_amount,current_date) returning id into v_payment;
 update public.hr_payslips set status='paid',payment_id=v_payment,paid_at=now(),updated_at=now() where id=p_id;
 return v_payment;
end;$$;

revoke all on function public.hr_request_attendance(text) from public;
revoke all on function public.hr_decide_attendance(bigint,boolean) from public;
revoke all on function public.hr_prepare_payslip(bigint,date,numeric) from public;
revoke all on function public.hr_pay_payslip(bigint) from public;
grant execute on function public.hr_request_attendance(text),public.hr_decide_attendance(bigint,boolean),public.hr_prepare_payslip(bigint,date,numeric),public.hr_pay_payslip(bigint) to authenticated;

-- Realtime: optional; notifications when app closed require Edge Function below.
do $$begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='hr_attendance') then
  alter publication supabase_realtime add table public.hr_attendance;
 end if;
end$$;
