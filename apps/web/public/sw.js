/* YaysApp service worker: shows notifications for new messages and clears them once read elsewhere. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = {}; }
  event.waitUntil((async () => {
    if (p.type === 'read') {
      // Read on another device: take this chat's notification away.
      const list = await self.registration.getNotifications({ tag: p.tag });
      list.forEach((n) => n.close());
      return;
    }
    if (p.type === 'call_end') {
      const list = await self.registration.getNotifications({ tag: p.tag });
      list.forEach((n) => n.close());
      return;
    }
    if (p.type === 'call') {
      // A tab that is open (even in the background) rings by itself; show the notification so it can be found.
      await self.registration.showNotification(p.title || 'YaysApp', {
        body: p.body || 'Incoming call', tag: p.tag, renotify: true, requireInteraction: true, icon: '/icon.png', badge: '/icon.png',
        data: { url: p.url || '/calls', callId: p.callId },
      });
      return;
    }
    if (p.type !== 'message') return;
    // If a YaysApp tab is open and in front, it shows its own banner instead.
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (tabs.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    await self.registration.showNotification(p.title || 'YaysApp', {
      body: p.body || 'New message', tag: p.tag, renotify: true, icon: '/icon.png', badge: '/icon.png',
      data: { url: p.url || '/chats', conversationId: p.conversationId },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/chats';
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) { await tab.focus(); tab.postMessage({ type: 'open', url }); return; }
    await self.clients.openWindow(url);
  })());
});
