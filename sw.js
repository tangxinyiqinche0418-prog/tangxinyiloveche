// ============================================================
// Service Worker - 후台消息生成 + 推送通知
// 网页关闭时也能自动生成消息，打开时看到积累的对话
// ============================================================

const SW_VERSION = 'v3';
const IDB_NAME   = 'wechat_storage';
const IDB_STORE  = 'images';

// ── IDB 헬퍼 ──
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains(IDB_STORE))
        e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}
function idbGet(key) {
  return openIDB().then(db => new Promise((res) => {
    const req = db.transaction(IDB_STORE,'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = e => res(e.target.result ?? null);
    req.onerror   = () => res(null);
  }));
}
function idbSet(key, val) {
  return openIDB().then(db => new Promise((res) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror    = () => res();
  }));
}

// ── SW 이벤트 ──
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

// ── 백그라운드 메시지 생성 (Periodic Background Sync) ──
self.addEventListener('periodicsync', e => {
  if (e.tag === 'generate-messages') {
    e.waitUntil(generateBackgroundMessages());
  }
});

// ── 푸시 알림 수신 ──
self.addEventListener('push', e => {
  let data = { title: '新消息 💌', body: '你有新消息' };
  try { data = e.data.json(); } catch(err) {
    try { data.body = e.data.text(); } catch(e2) {}
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:      data.body || '',
      icon:      data.icon || '',
      badge:     '',
      tag:       'wechat-msg',
      renotify:  true,
      vibrate:   [200, 100, 200],
      data:      { url: self.registration.scope }
    })
  );
});

// ── 알림 클릭 시 앱 열기 ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow(e.notification.data?.url || self.registration.scope);
    })
  );
});

// ── 메인: 백그라운드 메시지 생성 ──
async function generateBackgroundMessages() {
  try {
    // 현재 state 로드
    const stateRaw = await idbGet('sw_state');
    if (!stateRaw) return; // 아직 앱을 열지 않음

    const state = JSON.parse(stateRaw);
    const now = Date.now();
    const lastActive = state.lastActiveTime || now;

    // 마지막 활성 시간 이후 경과 시간
    const elapsed = now - lastActive;
    if (elapsed < 10 * 60 * 1000) return; // 10분 이내면 생성 안 함

    // 카드에서 랜덤 메시지 선택
    const cards = Object.values(state.cards || {}).flat().filter(t => t && t.trim());
    const loveLib = state.loveLibrary || [];
    const allTexts = [...cards, ...loveLib];
    const defaults = ['想你了','在干嘛呢','想和你聊聊','今天怎么样','嗯嗯','你在吗'];
    const pool = allTexts.length > 0 ? allTexts : defaults;

    // 경과 시간에 따라 메시지 수 결정
    const hours = elapsed / 3600000;
    const msgCount = Math.min(Math.floor(hours * 0.8) + 1, 8); // 최대 8개

    // 현재 저장된 메시지 로드
    const msgsRaw = await idbGet('messages');
    const messages = msgsRaw ? JSON.parse(msgsRaw) : [];

    // 새 메시지 생성 (경과 시간에 걸쳐 분산)
    const newMsgs = [];
    for (let i = 0; i < msgCount; i++) {
      const text = pool[Math.floor(Math.random() * pool.length)];
      // 메시지 시간을 경과 시간에 걸쳐 분산
      const msgTime = lastActive + (elapsed * (i + 1) / (msgCount + 1));
      newMsgs.push({
        id:      msgTime + i,
        from:    'other',
        content: text,
        type:    'text',
        time:    formatTime(msgTime),
        timestamp: msgTime,
        read:    false,
        recalled: false
      });
    }

    // 메시지 저장
    const updated = [...messages, ...newMsgs];
    await idbSet('messages', JSON.stringify(updated));

    // 푸시 알림 발송 (마지막 메시지로)
    const lastMsg = newMsgs[newMsgs.length - 1];
    const otherName = state.otherName || 'TA';
    await self.registration.showNotification(`${otherName} ${newMsgs.length > 1 ? `发来了${newMsgs.length}条消息` : '发来了消息'}`, {
      body:     lastMsg.content,
      tag:      'wechat-bg-msg',
      renotify: true,
      vibrate:  [200, 100, 200],
      data:     { url: self.registration.scope }
    });

    // 未读 카운트 업데이트
    await idbSet('sw_unread', String(newMsgs.length));

  } catch(e) {
    console.warn('SW generateBackgroundMessages error:', e);
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  return `${h}:${m}`;
}
