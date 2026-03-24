// Service Worker - 推送通知接收
const CACHE = 'wechat-v1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// 接收推送通知
self.addEventListener('push', e => {
  let data = { title: '新消息 💌', body: '你有一条新消息' };
  try { data = e.data.json(); } catch(err) {
    try { data.body = e.data.text(); } catch(err2) {}
  }
  e.waitUntil(
    self.registration.showNotification(data.title || '新消息 💌', {
      body: data.body || '',
      icon: data.icon || '',
      badge: '',
      tag: 'wechat-push',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: self.location.origin }
    })
  );
});

// 点击通知打开网页
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(e.notification.data?.url || '/');
    })
  );
});
