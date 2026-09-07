// storage/memory.ts —— 内存版存储端口（测试/演示用；行为与 IndexedDB 版一致）
import { idFromFileName, type StoragePort } from './port.ts';

export class MemoryStorage implements StoragePort {
  private files = new Map<string, string>();
  private meta = new Map<string, string>();

  constructor(seed?: { files?: Record<string, string>; meta?: Record<string, string> }) {
    if (seed?.files) {
      for (const [k, v] of Object.entries(seed.files)) this.files.set(k, v);
    }
    if (seed?.meta) {
      for (const [k, v] of Object.entries(seed.meta)) this.meta.set(k, v);
    }
  }

  async listNoteFiles(): Promise<string[]> {
    const names: string[] = [];
    for (const name of this.files.keys()) {
      if (idFromFileName(name)) names.push(name);
    }
    return names;
  }
  async readNoteFile(name: string): Promise<string | null> {
    return this.files.get(name) ?? null;
  }
  async writeNoteFile(name: string, content: string): Promise<void> {
    this.files.set(name, content);
  }
  async removeNoteFile(name: string): Promise<void> {
    this.files.delete(name);
  }
  async readMeta(key: string): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }
  async writeMeta(key: string, value: string): Promise<void> {
    this.meta.set(key, value);
  }
  async removeMeta(key: string): Promise<void> {
    this.meta.delete(key);
  }
  /** 快照（测试断言用） */
  snapshot(): { files: Map<string, string>; meta: Map<string, string> } {
    return { files: new Map(this.files), meta: new Map(this.meta) };
  }
}
