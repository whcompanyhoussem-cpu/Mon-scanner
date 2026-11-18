/* Mon Scanner Pro — Web Push service worker. No private data caching. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; }
  catch { data = { title: 'Mon Scanner Pro', body: 'Nouveau pointage à vérifier' }; }
  const title = String(data.title || 'Mon Scanner Pro');
  const url = new URL('./?pointage=1', self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(title, {
    body: String(data.body || 'Nouveau pointage en attente'),
    icon: new URL('./icon-192.png', self.registration.scope).href,
    badge: new URL('./icon-192.png', self.registration.scope).href,
    tag: String(data.tag || ('attendance-' + Date.now())),
    data: { url }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('./?pointage=1', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === new URL(target).origin && new URL(w.url).pathname.startsWith(new URL(self.registration.scope).pathname)) {
        try {
          if ('navigate' in w) await w.navigate(target);
          await w.focus();
          return;
        } catch (error) {
          // If navigation fails, try other clients or open a fresh app window.
          console.warn('notification click navigation failed', error);
        }
      }
    }
    await clients.openWindow(target);
  })());
});
