// settings/types.ts —— 设置数据模型（版本化；未知字段读取时保留，向后兼容）
import type { Shortcut } from '../core/actions.ts';

export type StartLayout = 'fig3' | 'fig4' | 'fig5';
export type DockSidePref = 'both' | 'left' | 'right';
export type EditorMode = 'edit' | 'split' | 'preview';

export interface GeneralSettings {
  /** 启动时停在哪一态（图3 仅侧栏 / 图4 列表 / 图5 完整） */
  startLayout: StartLayout;
  /** 是否记住上次的面板开合与所在文件夹 */
  rememberPanels: boolean;
}

export interface EditorSettings {
  defaultMode: EditorMode;
  /** 自动保存去抖（毫秒） */
  autoSaveMs: number;
  spellcheck: boolean;
}

export interface DockSettings {
  enabled: boolean;
  side: DockSidePref;
  /** 鼠标离开窗口后多久缩进（毫秒） */
  hideDelayMs: number;
  topmost: boolean;
  /** 屏幕边缘唤出热区宽度（逻辑像素） */
  hotZonePx: number;
  /** 仅图3 侧栏态生效 */
  onlySidebar: boolean;
}

export interface AppSettings {
  version: number;
  general: GeneralSettings;
  editor: EditorSettings;
  dock: DockSettings;
  /** 动作 id → 自定义键位；null 表示禁用该动作快捷键；缺省用默认键位 */
  shortcuts: Record<string, Shortcut | null>;
  /** 面板记忆（rememberPanels=true 时写入） */
  lastPanels?: { listOpen: boolean; editorOpen: boolean; folder: string | null };
}

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  general: { startLayout: 'fig3', rememberPanels: false },
  editor: { defaultMode: 'split', autoSaveMs: 600, spellcheck: false },
  dock: { enabled: true, side: 'both', hideDelayMs: 3000, topmost: true, hotZonePx: 14, onlySidebar: true },
  shortcuts: {},
};

export const AUTO_SAVE_RANGE = { min: 200, max: 2000 } as const;
export const HIDE_DELAY_RANGE = { min: 1000, max: 10000 } as const;
export const HOT_ZONE_RANGE = { min: 4, max: 40 } as const;
