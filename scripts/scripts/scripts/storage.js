/**
 * DV Ai — storage.js
 * IndexedDB local cache for chats/messages (offline-capable) plus
 * localStorage for lightweight preferences (theme, accent, font scale,
 * session token, device id).
 */

const DV_DB_NAME = "dv_ai_local";
const DV_DB_VERSION = 1;
const DV_STORE_CHATS = "dv_chats";
const DV_STORE_MESSAGES = "dv_messages";

const dvStorage = (() => {
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DV_DB_NAME, DV_DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DV_STORE_CHATS)) {
          db.createObjectStore(DV_STORE_CHATS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(DV_STORE_MESSAGES)) {
          const store = db.createObjectStore(DV_STORE_MESSAGES, { keyPath: "localId", autoIncrement: true });
          store.createIndex("chatId", "chatId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function dvPutChat(chat) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DV_STORE_CHATS, "readwrite");
      tx.objectStore(DV_STORE_CHATS).put(chat);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dvGetChats() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DV_STORE_CHATS, "readonly");
      const req = tx.objectStore(DV_STORE_CHATS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dvDeleteChat(chatId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([DV_STORE_CHATS, DV_STORE_MESSAGES], "readwrite");
      tx.objectStore(DV_STORE_CHATS).delete(chatId);
      const msgStore = tx.objectStore(DV_STORE_MESSAGES);
      const idx = msgStore.index("chatId");
      const cursorReq = idx.openCursor(IDBKeyRange.only(chatId));
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dvClearAllChats() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([DV_STORE_CHATS, DV_STORE_MESSAGES], "readwrite");
      tx.objectStore(DV_STORE_CHATS).clear();
      tx.objectStore(DV_STORE_MESSAGES).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dvPutMessages(chatId, messages) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DV_STORE_MESSAGES, "readwrite");
      const store = tx.objectStore(DV_STORE_MESSAGES);
      const idx = store.index("chatId");
      const cursorReq = idx.openCursor(IDBKeyRange.only(chatId));
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
        else {
          for (const m of messages) store.put({ chatId, ...m });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dvGetMessages(chatId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DV_STORE_MESSAGES, "readonly");
      const idx = tx.objectStore(DV_STORE_MESSAGES).index("chatId");
      const req = idx.getAll(IDBKeyRange.only(chatId));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // ---- Preferences (localStorage) ----
  const PREF_KEYS = {
    theme: "dv_pref_theme",
    accent: "dv_pref_accent",
    fontScale: "dv_pref_font_scale",
    token: "dv_session_token",
    deviceId: "dv_device_id",
    deviceName: "dv_device_name"
  };

  function dvGetPref(key, fallback = null) {
    try {
      const v = localStorage.getItem(PREF_KEYS[key] || key);
      return v === null ? fallback : v;
    } catch { return fallback; }
  }

  function dvSetPref(key, value) {
    try { localStorage.setItem(PREF_KEYS[key] || key, value); } catch { /* ignore quota errors */ }
  }

  function dvClearSession() {
    try {
      localStorage.removeItem(PREF_KEYS.token);
      localStorage.removeItem(PREF_KEYS.deviceId);
    } catch { /* ignore */ }
  }

  return {
    dvPutChat, dvGetChats, dvDeleteChat, dvClearAllChats,
    dvPutMessages, dvGetMessages,
    dvGetPref, dvSetPref, dvClearSession,
    PREF_KEYS
  };
})();
