/* Mon Scanner Pro V12 — push only, no caching of private payroll data */
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{}}catch(_){data={title:'Mon Scanner Pro',body:'Nouveau pointage à vérifier'}}
 event.waitUntil(self.registration.showNotification(String(data.title||'Mon Scanner Pro'),{
  body:String(data.body||'Nouveau pointage en attente'),icon:'./icon-192.png',badge:'./icon-192.png',tag:String(data.tag||'attendance'),data:{url:'./?pointage=1'}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
  for(const w of windows){if(w.url.startsWith(self.registration.scope)){await w.focus();return}}
  return clients.openWindow('./?pointage=1');
 }));
});
