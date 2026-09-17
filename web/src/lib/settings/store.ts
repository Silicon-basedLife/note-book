// settings/store.ts —— 设置读写与跨窗口同步
// 桌面：settings.json（应用配置目录，经 Rust 命令读写）+ Tauri 事件广播；
// Web 预览：localStorage + BroadcastChannel（同名多窗口同步）。
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { isTauriEnv } from '../core/storage/tauri.ts';
import { coerceSettings, preservedMerge } from './coerce.ts';
import type { AppSettings } from './types.ts';

const LS_KEY = 'noteapp.settings.v1';
const EVENT_NAME = 'settings:changed';
const CHANNEL_NAME = 'noteapp-settings';

let rawCache: unknown = null;

let channel: BroadcastChannel | null | undefined;
function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
  }
  return channel;
}

/** 读取设置（非法值自动回退默认；未知字段保留在 rawCache 中待写回） */
export async function loadSettings(): Promise<AppSettings> {
  if (isTauriEnv()) {
    try {
      const text = await invoke<string | null>('read_settings');
      rawCache = text ? JSON.parse(text) : null;
    } catch {
      rawCache = null;
    }
  } else {
    try {
      const text = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
      rawCache = text ? JSON.parse(text) : null;
    } catch {
      rawCache = null;
    }
  }
  return coerceSettings(rawCache);
}

/** 保存设置（保留未知字段）并广播给其它窗口 */
export async function saveSettings(next: AppSettings): Promise<void> {
  const merged = preservedMerge(rawCache, next);
  rawCache = merged;
  const text = JSON.stringify(merged, null, 2);
  if (isTauriEnv()) {
    await invoke('write_settings', { content: text });
    const payload = coerceSettings(merged);
    await emit(EVENT_NAME, payload);
  } else {
    try { localStorage.setItem(LS_KEY, text); } catch { /* ignore */ }
    getChannel()?.postMessage(coerceSettings(merged));
  }
}

/** 订阅设置变化（返回取消订阅函数） */
export function subscribeSettings(cb: (s: AppSettings) => void): () => void {
  if (isTauriEnv()) {
    let unlisten: (() => void) | undefined;
    void listen<unknown>(EVENT_NAME, (ev) => {
      rawCache = ev.payload;
      cb(coerceSettings(ev.payload));
    }).then((un) => { unlisten = un; });
    return () => unlisten?.();
  }
  const ch = getChannel();
  if (!ch) return () => {};
  const onMessage = (ev: MessageEvent) => cb(coerceSettings(ev.data));
  ch.addEventListener('message', onMessage);
  return () => ch.removeEventListener('message', onMessage);
}
