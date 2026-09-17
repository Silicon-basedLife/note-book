// settings/storage-admin.ts —— 存储位置管理（仅桌面 Tauri 可用）
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnv } from '../core/storage/tauri.ts';
import { normalizeStorageInfo, type StorageInfo } from './storage-info.ts';

export type { StorageInfo };

export function storageAdminAvailable(): boolean {
  return isTauriEnv();
}

export async function getStorageInfo(): Promise<StorageInfo> {
  return normalizeStorageInfo(await invoke<unknown>('get_storage_info'));
}

/** 用系统文件管理器打开目录 */
export async function openPath(path: string): Promise<void> {
  await invoke('open_path', { path });
}

/** 弹出系统“选择文件夹”对话框；取消返回 null */
export async function pickFolder(): Promise<string | null> {
  return invoke<string | null>('pick_folder');
}

/** 迁移笔记目录：复制现有笔记与 meta.json 到目标目录并切换（失败不改动配置） */
export async function migrateNotes(target: string): Promise<StorageInfo> {
  return normalizeStorageInfo(await invoke<unknown>('migrate_notes', { target }));
}
