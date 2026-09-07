// core-client.ts —— UI 与 Core 之间的类型化装配入口（shared 层）
// 对应 docs/TECH_DESIGN.md：UI 只经 core-client 使用核心；数据层可插拔。
// - 浏览器环境：IndexedDB 虚拟文件系统持久化
// - 其它环境（测试/构建期 import）：内存存储，避免副作用
// 未来 Tauri 桌面壳接入：把 storage 换成真实 fs 适配器（或改为 invoke Rust core），
// core-client 之上的 UI/组件无需改动。
import { NoteCore } from '../lib/core/store.ts';
import { IndexedDbStorage } from '../lib/core/storage/idb.ts';
import { MemoryStorage } from '../lib/core/storage/memory.ts';
import type { NoteDoc } from '../lib/core/types.ts';

/** 创建并初始化核心（启动扫描建索引，完成后 ready） */
export async function createCore(): Promise<NoteCore> {
  const storage =
    typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
      ? new IndexedDbStorage()
      : new MemoryStorage();
  const core = new NoteCore(storage);
  await core.init();
  return core;
}

/** 列表展示标题：空标题回退占位文案 */
export function displayTitle(doc: Pick<NoteDoc, 'title'>): string {
  const t = (doc.title || '').trim();
  return t === '' ? '无标题笔记' : t;
}

/** 列表第二行摘要（来自纯文本正文） */
export function excerptOf(text: string, max = 64): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}
