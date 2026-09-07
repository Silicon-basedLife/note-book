// storage/idb.ts —— 浏览器 IndexedDB 虚拟文件系统（Web 版本地持久化）
// 结构刻意贴近"目录"：一个笔记对应一条 key = "<id>.md" 的记录，
// value 为完整文件内容（frontmatter + 正文）。元数据键值单独存放。
// 未来桌面 Tauri 壳接入时，以实现了 StoragePort 的真实 fs 适配器替换即可。
import { type StoragePort } from './port.ts';

const DB_NAME = 'noteapp';
const DB_VERSION = 1;
const STORE_FILES = 'files';
const STORE_META = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('transaction error'));
  });
}

export class IndexedDbStorage implements StoragePort {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('当前环境不支持 IndexedDB'));
    }
    this.dbPromise ??= openDb();
    return this.dbPromise;
  }

  async listNoteFiles(): Promise<string[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const req = tx.objectStore(STORE_FILES).getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
      req.onerror = () => reject(req.error ?? new Error('getAllKeys failed'));
    });
  }

  private async get(store: string, key: string): Promise<string | null> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => {
        const row = req.result as { value?: string } | undefined;
        resolve(row?.value ?? null);
      };
      req.onerror = () => reject(req.error ?? new Error('get failed'));
    });
  }

  private async put(store: string, row: { key?: string; name?: string; value: string }): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(row);
    return txDone(tx);
  }

  private async remove(store: string, key: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    return txDone(tx);
  }

  async readNoteFile(name: string): Promise<string | null> {
    return this.get(STORE_FILES, name);
  }
  async writeNoteFile(name: string, content: string): Promise<void> {
    return this.put(STORE_FILES, { name, value: content });
  }
  async removeNoteFile(name: string): Promise<void> {
    return this.remove(STORE_FILES, name);
  }
  async readMeta(key: string): Promise<string | null> {
    return this.get(STORE_META, key);
  }
  async writeMeta(key: string, value: string): Promise<void> {
    return this.put(STORE_META, { key, value });
  }
  async removeMeta(key: string): Promise<void> {
    return this.remove(STORE_META, key);
  }
}
