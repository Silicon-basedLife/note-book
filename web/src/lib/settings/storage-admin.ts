// settings/storage-admin.ts —— 存储位置管理（仅桌面 Tauri 可用）
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv } from '../core/storage/tauri.ts';

export interface StorageInfo {
  appVersion: string;
  /** 应用配置目录（settings.json / storage.json 所在） */
  dataDir: string;
  /** 当前笔记目录（含 meta.json） */
  notesDir: string;
  /** 默认笔记目录（自定义前的位置） */
  defaultNotesDir: string;
  settingsFile: string;
  /** 是否已自定义存储位置 */
  isCustom: boolean;
}

export function storageAdminAvailable(): boolean {
  return isTauriEnv();
}

export async function getStorageInfo(): Promise<StorageInfo> {
  return invoke<StorageInfo>('get_storage_info');
}

/** 用系统文件管理器打开目录 */
export async function openPath(path: string): Promise<void> {
  await invoke('open_path', { path });
}

/** 迁移笔记目录：复制现有笔记与 meta.json 到目标目录并切换（失败不改动配置） */
export async function migrateNotes(target: string): Promise<StorageInfo> {
  return invoke<StorageInfo>('migrate_notes', { target });
}
