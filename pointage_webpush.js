/* Load AFTER employee_module.js. Does not change attendance or approval decisions. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const message = text => { const x=byId('empPushStatus'); if(x) x.textContent=text; };
  const enc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Publish this ONLY after creating a matching VAPID key pair. Never expose the private key.
  const VAPID_PUBLIC_KEY = 'REPLACE_WITH_REAL_VAPID_PUBLIC_KEY';
  const decode = key => {
    const normalized=key.replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(normalized+'='.repeat((4-normalized.length%4)%4));
    return Uint8Array.from(raw,c=>c.charCodeAt(0));
  };
  window.empEnablePush = async function () {
    if (!admin || !currentUser) return;
    try {
      if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
        throw Error('Ouvrez Mon Scanner depuis son icône sur l’écran d’accueil iPhone (iOS 16.4+), en HTTPS.');
      if (VAPID_PUBLIC_KEY.startsWith('REPLACE_')) throw Error('Configurez la clé VAPID publique dans pointage_webpush.js.');
      if (Notification.permission==='denied') throw Error('Autorisez les notifications dans Réglages iPhone.');
      const reg=await navigator.serviceWorker.register('./sw.js', {scope:'./'});
      await navigator.serviceWorker.ready;
      const permission=await Notification.requestPermission();
      if(permission!=='granted') throw Error('Autorisation refusée.');
      let sub=await reg.pushManager.getSubscription();
      if(sub) {
        const k=sub.options?.applicationServerKey;
        const requested=decode(VAPID_PUBLIC_KEY);
        if(k && (new Uint8Array(k).length!==requested.length || !new Uint8Array(k).every((v,i)=>v===requested[i]))) {
          await sub.unsubscribe(); sub=null;
        }
      }
      if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(VAPID_PUBLIC_KEY)});
      const json=sub.toJSON();
      if(!json.keys?.p256dh || !json.keys?.auth) throw Error('Subscription keys missing.');
      const r=await sb.from('attendance_web_subscriptions').upsert({
        user_id:currentUser.id, endpoint:sub.endpoint,
        p256dh:json.keys.p256dh, auth_secret:json.keys.auth,
        updated_at:new Date().toISOString()
      },{onConflict:'endpoint'});
      if(r.error) throw r.error;
      message('✅ Notifications iPhone activées sur cet appareil.');
      await window.monScannerLoadPointageInbox();
    } catch(err) { message('⚠️ '+(err?.message||String(err))); }
  };
  window.monScannerLoadPointageInbox=async function () {
    if(!admin || !currentUser || !sb) return;
    const target=byId('pointageWebPushInbox'); if(!target) return;
    const r=await sb.from('attendance_web_notifications')
      .select('id,attendance_id,title,body,created_at')
      .eq('recipient_id',currentUser.id).order('created_at',{ascending:false}).limit(50);
    if(r.error) {target.textContent='⚠️ Notifications indisponibles : '+r.error.message;return;}
    const rows=r.data||[];
    target.innerHTML=rows.length?rows.map(x=>`<div class="product"><b>${enc(x.title)}</b><div>${enc(x.body)}</div><div class="small">${enc(new Date(x.created_at).toLocaleString('fr-TN'))}</div></div>`).join(''):'<p class="small">Aucun pointage signalé.</p>';
  };
  // Diagnostics are non-destructive. A local notification is NOT a server Push delivery test.
  window.monScannerPushDiagnostic=async function () {
    const status=byId('empPushStatus');
    const show=t=>{if(status)status.textContent=t;};
    if(!admin || !currentUser || !sb) {show('Connexion administrateur requise.');return;}
    try {
      if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))
        throw Error('Web Push non pris en charge dans ce contexte. Sur iPhone, ouvrir depuis l’écran d’accueil.');
      const reg=await navigator.serviceWorker.getRegistration('./');
      const sub=reg?await reg.pushManager.getSubscription():null;
      if (sub?.options?.applicationServerKey) {

  const bytes = new Uint8Array(sub.options.applicationServerKey);

  const key = btoa(String.fromCharCode(...bytes))

    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  show('VAPID_PUBLIC_KEY : ' + key);

  return;

}
      const q=await 
sb.from('hr_push_subscriptions').select('id').eq('user_id',currentUser.id);
      if(q.error)throw q.error;
      const rows=q.data||[];
      show('Autorisation iPhone : '+Notification.permission+' | Service Worker : '+(reg?'oui':'non')+
        ' | Abonnement local : '+(sub?'oui':'non')+' | Appareils enregistrés dans Supabase : '+rows.length+
        '. Ceci ne confirme pas la livraison d’un vrai Push.');
    }catch(err){show('Diagnostic : '+(err?.message||String(err)));}
  };
  window.monScannerLocalNotificationTest=async function () {
    const status=byId('empPushStatus');
    const show=t=>{if(status)status.textContent=t;};
    if(!admin || !currentUser)return;
    try{
      if(!('serviceWorker' in navigator))throw Error('Service Worker indisponible.');
      if(Notification.permission!=='granted')throw Error('Autorisation de notifications absente.');
      const reg=await navigator.serviceWorker.getRegistration('./');
      if(!reg)throw Error('Service Worker non enregistré.');
      await reg.showNotification('Mon Scanner Pro — Test local',{
        body:'Test sur ce téléphone uniquement. Aucun Pointage créé.',
        tag:'mon-scanner-local-test',data:{url:new URL('./?pointage=1',location.href).href}
      });
      show('Test local demandé. Cela ne prouve PAS l’envoi depuis Supabase.');
    }catch(err){show('Test local : '+(err?.message||String(err)));}
  };
  const panel=byId('employes');
  if(panel){
    const card=document.createElement('div'); card.className='card';
    card.innerHTML='<h2>🔔 Notifications des pointages</h2><button class="gray full" type="button" id="refreshPointageNotifications">Actualiser les notifications</button><div id="pointageWebPushInbox"></div>';
    panel.appendChild(card);
    const diag=byId('empPushStatus');
    if(diag){const tools=document.createElement('div');tools.className='actionBar';
      tools.innerHTML='<button class="gray" type="button" id="pointagePushDiagnostic">🔎 Vérifier l’inscription iPhone</button><button class="gray" type="button" id="pointageLocalPushTest">🔔 Test local (sans pointage)</button>';
      diag.parentElement.insertBefore(tools,diag);
      byId('pointagePushDiagnostic').onclick=()=>void window.monScannerPushDiagnostic();
      byId('pointageLocalPushTest').onclick=()=>void window.monScannerLocalNotificationTest();
    }
    byId('refreshPointageNotifications').addEventListener('click',()=>void window.monScannerLoadPointageInbox());
  }
  const previousTab=window.tab;
  window.tab=function(id){const result=previousTab.apply(this,arguments);if(id==='employes')void window.monScannerLoadPointageInbox();return result;};
  // Poll only while the admin screen is visible. Push reception itself never depends on polling.
  setInterval(()=>{
    if(admin && currentUser && document.visibilityState==='visible' && !byId('employes')?.classList.contains('hidden'))
      void window.monScannerLoadPointageInbox();
  },15000);
  // Restore Pointage navigation after clicking a push notification.
  const openPointageFromUrl=()=>{
    if(!new URLSearchParams(location.search).has('pointage') || !currentUser) return;
    window.tab(admin?'employes':'pointage');
  };
  window.addEventListener('focus',openPointageFromUrl);
  // Auth boot is asynchronous. A short poll handles the initial navigation without changing login.
  let n=0; const navTimer=setInterval(()=>{
    if(currentUser){clearInterval(navTimer);openPointageFromUrl();}
    else if(++n>=30)clearInterval(navTimer);
  },500);
})();
