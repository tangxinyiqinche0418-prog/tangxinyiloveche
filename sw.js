// ============================================================
// sw.js  —  Service Worker
// 放在 GitHub Pages 仓库根目录（和 .html 同级）
// 负责：
//   1. 接收 Web Push 推送 → 弹通知
//   2. 把消息写入 IndexedDB → 用户打开页面后能看到
//   3. 通知被点击 → 打开/聚焦网页
// ============================================================

const DB_NAME    = 'wechat_idb';
const DB_VERSION = 1;
const STORE      = 'kv';

// ── 打开 IDB ──
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'k' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── 从 IDB 读 ──
async function idbGet(key) {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = e => resolve(e.target.result ? e.target.result.v : null);
    req.onerror   = e => reject(e.target.error);
  });
}

// ── 向 IDB 写 ──
async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put({ k: key, v: value });
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ── 生成消息 ID ──
function makeId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

// ── 时间格式化 ──
function nowStr() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ============================================================
// 收到 Push 事件
// ============================================================
self.addEventListener('push', event => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let title = 'TA 说';
  let body  = '有新消息';
  let icon  = '';

  // 解析推送内容
  try {
    if (event.data) {
      const data = event.data.json();
      title = data.title || title;
      body  = data.body  || body;
      icon  = data.icon  || icon;
    }
  } catch(e) {
    try { body = event.data ? event.data.text() : body; } catch(e2) {}
  }

  // 1. 把消息写入 IDB（让页面打开后能看到）
  try {
    await writeMessageToIDB(body, title);
  } catch(e) {
    console.warn('SW: write message to IDB failed', e);
  }

  // 2. 弹系统通知
  const options = {
    body:     body,
    icon:     icon || '/icon-192.png',
    badge:    '/icon-192.png',
    tag:      'wechat-push',
    renotify: true,
    vibrate:  [200, 100, 200, 100, 200],
    data:     { url: self.registration.scope },
    actions:  [
      { action: 'open', title: '查看消息' },
    ],
  };

  await self.registration.showNotification(title, options);
}

// ── 把推送消息追加到 IDB messages 列表 ──
async function writeMessageToIDB(body, title) {
  // 读现有消息列表
  const raw = await idbGet('messages');
  const messages = raw ? JSON.parse(raw) : [];

  // 从 sw_state 读 otherName（保证名字正确）
  let otherName = title.replace(' 说', '').trim() || 'TA';
  try {
    const swStateRaw = await idbGet('sw_state');
    if (swStateRaw) {
      const swState = JSON.parse(swStateRaw);
      if (swState.otherName) otherName = swState.otherName;
    }
  } catch(e) {}

  // 构造新消息（格式与网页 addMessage 一致）
  const newMsg = {
    id:      makeId(),
    from:    'other',
    content: body,
    type:    'text',
    time:    nowStr(),
    sentAt:  Date.now(),
    read:    false,
  };

  messages.push(newMsg);
  await idbSet('messages', JSON.stringify(messages));

  // 累计未读数（打开页面时会显示 toast）
  const unreadRaw = await idbGet('sw_unread');
  const unread = unreadRaw ? parseInt(unreadRaw) : 0;
  await idbSet('sw_unread', String(unread + 1));
}

// ============================================================
// 点击通知 → 打开/聚焦页面
// ============================================================
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    || self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // 已有打开的窗口 → 聚焦
      for (const client of list) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      // 没有 → 新开
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ============================================================
// Install / Activate（让 SW 立即生效）
// ============================================================
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));
