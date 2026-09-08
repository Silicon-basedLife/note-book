// db.mjs —— IndexedDB 持久化适配器（需求 #6：排序等状态持久化到 IndexedDB）
// 浏览器内优先使用 IndexedDB；不可用时（老浏览器/隐私模式/Node 环境）由调用方降级到 localStorage。
// 本模块不依赖任何第三方库；Node 测试环境不导入本模块。

const DB_NAME = 'noteapp-demo-db';
const DB_VERSION = 1;
const STORE = 'kv';
const KEY = 'state';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(STORE, mode);
    } catch (e) {
      db.close();
      reject(e);
      return;
    }
    const store = tx.objectStore(STORE);
    try {
      const result = fn(store);
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('事务中止'));
      };
    } catch (e) {
      db.close();
      reject(e);
    }
  });
}

// 读取：无数据或失败时返回 null
export async function dbLoad() {
  try {
    const value = await withStore('readonly', (store) => {
      const req = store.get(KEY);
      return promisify(req);
    });
    return value || null;
  } catch (e) {
    return null;
  }
}

export async function dbSave(state) {
  try {
    await withStore('readwrite', (store) => {
      const req = store.put({ folders: state.folders, notes: state.notes, savedAt: new Date().toISOString() }, KEY);
      return promisify(req);
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function dbClear() {
  try {
    await withStore('readwrite', (store) => {
      const req = store.delete(KEY);
      return promisify(req);
    });
    return true;
  } catch (e) {
    return false;
  }
}
