// settings/types.ts —— 设置数据模型（版本化；未知字段读取时保留，向后兼容）
import type { Shortcut } from '../core/actions.ts';

export type StartLayout = 'fig3' | 'fig4' | 'fig5';
export type DockSidePref = 'both' | 'left' | 'right';
export type EditorMode = 'edit' | 'split' | 'preview';
/** 主题：浅色 / 深色 / 跟随系统 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 主题可选值（归一化与设置页共用同一份，避免两处漂移） */
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'] as const;
/** 判定“跟随系统”时用的媒体查询（theme.ts 运行时复用同一常量） */
export const DARK_QUERY = '(prefers-color-scheme: dark)';

export interface GeneralSettings {
  /** 启动时停在哪一态（图3 仅侧栏 / 图4 列表 / 图5 完整） */
  startLayout: StartLayout;
  /** 是否记住上次的面板开合与所在文件夹 */
  rememberPanels: boolean;
  /** 外观主题；默认浅色（保持既有观感，不因系统深色而静默变脸） */
  theme: ThemeMode;
}

export interface EditorSettings {
  defaultMode: EditorMode;
  /** 自动保存去抖（毫秒） */
  autoSaveMs: number;
  spellcheck: boolean;
  /** 单个换行在预览里是否直接换行（`<br>`）；关掉则按严格 CommonMark 折叠进同一段落 */
  hardBreaks: boolean;
  /** 分屏时编辑区占编辑面板的比例（0.2–0.8）；拖动中间分隔条时写入 */
  splitRatio: number;
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
  general: { startLayout: 'fig3', rememberPanels: false, theme: 'light' },
  editor: { defaultMode: 'split', autoSaveMs: 600, spellcheck: false, hardBreaks: true, splitRatio: 0.5 },
  dock: { enabled: true, side: 'both', hideDelayMs: 3000, topmost: true, hotZonePx: 14, onlySidebar: true },
  shortcuts: {},
};

export const AUTO_SAVE_RANGE = { min: 200, max: 2000 } as const;
export const HIDE_DELAY_RANGE = { min: 1000, max: 10000 } as const;
export const HOT_ZONE_RANGE = { min: 4, max: 40 } as const;
/** 分屏比例范围：两侧各至少留 20%，避免拖到 0 宽后“面板消失”找不回来 */
export const SPLIT_RATIO_RANGE = { min: 0.2, max: 0.8 } as const;
