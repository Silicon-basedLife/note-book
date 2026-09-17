// settings/shortcuts.ts —— 键位归一化、生效键位与冲突检测（纯函数，可单测）
import type { Shortcut } from '../core/actions.ts';
import { ACTIONS } from './catalog.ts';

export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** 键位的唯一签名（修饰键顺序固定 + 归一化主键） */
export function shortcutSignature(s: Shortcut): string {
  const mods = [s.ctrl ? 'C' : '', s.alt ? 'A' : '', s.shift ? 'S' : '', s.meta ? 'M' : ''].join('');
  return `${mods}+${normalizeKey(s.key)}`;
}

export function formatShortcut(s?: Shortcut | null): string {
  if (!s) return '未设置';
  const mods: string[] = [];
  if (s.meta) mods.push('Meta');
  if (s.ctrl) mods.push('Ctrl');
  if (s.alt) mods.push('Alt');
  if (s.shift) mods.push('Shift');
  const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
  return [...mods, key].join(' + ');
}

/** 生效键位 = 自定义覆盖（含 null=禁用）优先，否则默认键位 */
export function effectiveShortcuts(overrides: Record<string, Shortcut | null>): Record<string, Shortcut | null> {
  const out: Record<string, Shortcut | null> = {};
  for (const action of ACTIONS) {
    out[action.id] = Object.prototype.hasOwnProperty.call(overrides, action.id)
      ? overrides[action.id] ?? null
      : action.defaultShortcut;
  }
  return out;
}

/** 冲突检测：返回与目标键位冲突的动作中文名（无冲突返回 null） */
export function findShortcutConflict(
  actionId: string,
  shortcut: Shortcut | null,
  overrides: Record<string, Shortcut | null>
): string | null {
  if (!shortcut) return null;
  const target = shortcutSignature(shortcut);
  const effective = effectiveShortcuts(overrides);
  for (const action of ACTIONS) {
    if (action.id === actionId) continue;
    const other = effective[action.id];
    if (other && shortcutSignature(other) === target) return action.label;
  }
  return null;
}

/** 键位合法性：至少一个修饰键（避免吞掉普通输入） */
export function isShortcutAllowed(s: Shortcut): boolean {
  return !!(s.ctrl || s.alt || s.meta);
}
