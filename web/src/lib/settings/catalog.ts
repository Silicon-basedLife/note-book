// settings/catalog.ts —— 可自定义快捷键的动作目录（设置窗口与主窗口共用）
import type { Shortcut } from '../core/actions.ts';

export interface ActionMeta {
  id: string;
  label: string;
  description?: string;
  defaultShortcut: Shortcut | null;
}

/** 首版可自定义的应用内动作（与主窗口注册的动作一一对应） */
export const ACTIONS: ActionMeta[] = [
  { id: 'new-note', label: '新建笔记', defaultShortcut: { key: 'n', alt: true } },
  { id: 'focus-search', label: '聚焦搜索', defaultShortcut: { key: 'k', ctrl: true } },
  { id: 'save-now', label: '立即保存', defaultShortcut: { key: 's', ctrl: true } },
  { id: 'open-settings', label: '打开设置', defaultShortcut: { key: ',', ctrl: true } },
  { id: 'help', label: '快捷键帮助', defaultShortcut: { key: '?', shift: true } },
];

export function actionById(id: string): ActionMeta | undefined {
  return ACTIONS.find((a) => a.id === id);
}
