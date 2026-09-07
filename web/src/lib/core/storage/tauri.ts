// storage/tauri.ts —— Tauri 桌面存储适配器（实现 StoragePort）
// 把 web/src/lib/core/storage/port.ts 的端口映射到 Rust 薄壳命令：
// 笔记 → %APPDATA%\com.noteapp.desktop\notes\<id>.md，元数据 → meta.json（见 src-tauri/src/fs_store.rs）。
// 因此同一套 NoteCore/UI 在桌面版使用真实本地文件，Web 开发版回退 IndexedDB。
import { invoke } from '@tauri-apps/api/core';
import type { StoragePort } from './port.ts';

/** 是否运行在 Tauri 桌面壳内（Tauri 注入 __TAURI_INTERNALS__） */
export function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export class TauriStorage implements StoragePort {
  listNoteFiles(): Promise<string[]> {
    return invoke<string[]>('list_note_files');
  }
  readNoteFile(name: string): Promise<string | null> {
    return invoke<string | null>('read_note_file', { name });
  }
  writeNoteFile(name: string, content: string): Promise<void> {
    return invoke<void>('write_note_file', { name, content });
  }
  removeNoteFile(name: string): Promise<void> {
    return invoke<void>('remove_note_file', { name });
  }
  readMeta(key: string): Promise<string | null> {
    return invoke<string | null>('read_meta', { key });
  }
  writeMeta(key: string, value: string): Promise<void> {
    return invoke<void>('write_meta', { key, value });
  }
  removeMeta(key: string): Promise<void> {
    return invoke<void>('remove_meta', { key });
  }
}
