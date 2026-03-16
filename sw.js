// Service Worker for 私信 PWA
const CACHE_NAME = 'wechat-pwa-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'NOTIFY') {
    self.registration.showNotification(e.data.title || '新消息', {
      body: e.data.body || '',
      icon: e.data.icon || '',
      badge: e.data.icon || '',
      tag: 'wechat',
      renotify: true,
      vibrate: [200, 100, 200]
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('./');
    })
  );
});
