// settings/coerce.ts —— 设置读取归一化 + 写回时保留未知字段（向前兼容）
import type { Shortcut } from '../core/actions.ts';
import { ACTIONS } from './catalog.ts';
import {
  AUTO_SAVE_RANGE,
  DEFAULT_SETTINGS,
  HIDE_DELAY_RANGE,
  HOT_ZONE_RANGE,
  SETTINGS_VERSION,
  type AppSettings,
  type DockSidePref,
  type EditorMode,
  type StartLayout,
} from './types.ts';

type Obj = Record<string, unknown>;

function asObject(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}
function pickBool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}
function clampNum(v: unknown, d: number, range: { min: number; max: number }): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN;
  if (!Number.isFinite(n)) return d;
  return Math.min(range.max, Math.max(range.min, n));
}
function pickEnum<T extends string>(v: unknown, allowed: readonly T[], d: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : d;
}

function sanitizeShortcut(v: unknown): Shortcut | null {
  const o = asObject(v);
  const key = typeof o.key === 'string' ? o.key.trim() : '';
  if (!key || key.length > 24) return null;
  const out: Shortcut = { key };
  if (o.ctrl === true) out.ctrl = true;
  if (o.alt === true) out.alt = true;
  if (o.shift === true) out.shift = true;
  if (o.meta === true) out.meta = true;
  return out;
}

/** 把任意读取到的 JSON 归一化为合法设置（非法值回退默认） */
export function coerceSettings(raw: unknown): AppSettings {
  const o = asObject(raw);
  const g = asObject(o.general);
  const e = asObject(o.editor);
  const dk = asObject(o.dock);
  const shortcutsRaw = asObject(o.shortcuts);
  const shortcuts: Record<string, Shortcut | null> = {};
  for (const [id, v] of Object.entries(shortcutsRaw)) {
    if (!id) continue;
    if (v === null) shortcuts[id] = null;
    else {
      const s = sanitizeShortcut(v);
      if (s) shortcuts[id] = s;
    }
  }
  const lastPanelsRaw = asObject(o.lastPanels);
  const lastPanels =
    typeof lastPanelsRaw.listOpen === 'boolean' && typeof lastPanelsRaw.editorOpen === 'boolean'
      ? {
          listOpen: lastPanelsRaw.listOpen,
          editorOpen: lastPanelsRaw.editorOpen,
          folder: typeof lastPanelsRaw.folder === 'string' ? lastPanelsRaw.folder : null,
        }
      : undefined;

  return {
    version: SETTINGS_VERSION,
    general: {
      startLayout: pickEnum<StartLayout>(g.startLayout, ['fig3', 'fig4', 'fig5'], DEFAULT_SETTINGS.general.startLayout),
      rememberPanels: pickBool(g.rememberPanels, DEFAULT_SETTINGS.general.rememberPanels),
    },
    editor: {
      defaultMode: pickEnum<EditorMode>(e.defaultMode, ['edit', 'split', 'preview'], DEFAULT_SETTINGS.editor.defaultMode),
      autoSaveMs: clampNum(e.autoSaveMs, DEFAULT_SETTINGS.editor.autoSaveMs, AUTO_SAVE_RANGE),
      spellcheck: pickBool(e.spellcheck, DEFAULT_SETTINGS.editor.spellcheck),
    },
    dock: {
      enabled: pickBool(dk.enabled, DEFAULT_SETTINGS.dock.enabled),
      side: pickEnum<DockSidePref>(dk.side, ['both', 'left', 'right'], DEFAULT_SETTINGS.dock.side),
      hideDelayMs: clampNum(dk.hideDelayMs, DEFAULT_SETTINGS.dock.hideDelayMs, HIDE_DELAY_RANGE),
      topmost: pickBool(dk.topmost, DEFAULT_SETTINGS.dock.topmost),
      hotZonePx: clampNum(dk.hotZonePx, DEFAULT_SETTINGS.dock.hotZonePx, HOT_ZONE_RANGE),
      onlySidebar: pickBool(dk.onlySidebar, DEFAULT_SETTINGS.dock.onlySidebar),
    },
    shortcuts,
    ...(lastPanels ? { lastPanels } : {}),
  };
}

function mergeGroup(prev: unknown, next: unknown): Obj {
  return { ...asObject(prev), ...asObject(next) };
}

/** 写回时把新设置合并到原始 JSON 上：未知字段（未来版本 / 手工添加）不被丢弃。
 *  注意：shortcuts 是“当前覆盖集合”，删除（点“默认”）必须生效，
 *  因此只保留旧文件中当前版本不认识的动作 id，其余以新值为准。 */
export function preservedMerge(previousRaw: unknown, next: AppSettings): Obj {
  const prev = asObject(previousRaw);
  const merged: Obj = { ...prev };
  merged.version = SETTINGS_VERSION;
  merged.general = mergeGroup(prev.general, next.general);
  merged.editor = mergeGroup(prev.editor, next.editor);
  merged.dock = mergeGroup(prev.dock, next.dock);
  const knownIds = new Set(ACTIONS.map((a) => a.id));
  const carriedUnknown: Obj = {};
  for (const [id, value] of Object.entries(asObject(prev.shortcuts))) {
    if (!knownIds.has(id)) carriedUnknown[id] = value;
  }
  merged.shortcuts = { ...carriedUnknown, ...next.shortcuts };
  if (next.lastPanels) merged.lastPanels = { ...asObject(prev.lastPanels), ...next.lastPanels };
  else delete merged.lastPanels;
  return merged;
}
