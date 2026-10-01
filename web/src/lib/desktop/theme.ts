// desktop/theme.ts —— 主题（浅色 / 深色 / 跟随系统）的纯逻辑与运行时应用
//
// 设计要点：
// 1) 解析与应用分离：resolveTheme 是无副作用的纯函数（可在 node:test 里直接断言），
//    applyTheme 只碰 document.documentElement，不做业务判断。
// 2) 主题落点是 <html data-theme="light|dark">，CSS 变量按该属性切档（见 main/app.css）；
//    同时设置 inline color-scheme，让原生控件（滚动条、输入框、下拉）跟随。
// 3) 「跟随系统」用 matchMedia 读取；实时跟随只在“当前档位真的是 system”时才订阅
//    （watchSystemTheme），显式选了浅/深就完全不监听，避免无谓回调与遗留监听器。
// 4) 窗口入口在挂载前调用 applyCachedTheme()，先按设置快照把主题定下来，避免深色用户
//    看到一闪而过的白屏（FOUC）；快照缺失时不写 data-theme，交给 CSS 的
//    @media (prefers-color-scheme: dark) 兜底，等异步读到真实设置后再精确应用。
import { coerceSettings } from '../settings/coerce.ts';
import { DARK_QUERY, type ThemeMode } from '../settings/types.ts';

/** 设置快照在 localStorage 里的键（与 settings/store.ts 保持一致） */
export const SETTINGS_LS_KEY = 'noteapp.settings.v1';

/** 解析后的实际配色（不含 system） */
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeEnv {
  /** “跟随系统”时系统是否偏好深色；缺省视为浅色 */
  prefersDark?: boolean;
}

/** 把「浅色 / 深色 / 跟随系统」解析为实际配色（纯函数，无副作用） */
export function resolveTheme(mode: ThemeMode, env: ThemeEnv = {}): ResolvedTheme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return env.prefersDark ? 'dark' : 'light';
}

/** 读取系统是否偏好深色（无 matchMedia 时按浅色处理，便于单测与无 DOM 环境） */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(DARK_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** 应用主题到文档：data-theme 属性 + inline color-scheme。非法值忽略。 */
export function applyTheme(resolved: ResolvedTheme, doc?: Document | null): void {
  const target = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!target || !target.documentElement) return;
  if (resolved !== 'light' && resolved !== 'dark') return;
  const root = target.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

/**
 * 读取 localStorage 里的主题快照（同步、容错：缺省/损坏一律返回 undefined）。
 * 桌面端设置存在 settings.json（Rust 侧），这里读不到 → undefined，
 * 由 loadSettings 之后的 applyThemeMode 兜底。
 */
export function readCachedThemeMode(): ThemeMode | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const text = localStorage.getItem(SETTINGS_LS_KEY);
    if (!text) return undefined;
    const mode = coerceSettings(JSON.parse(text)).general.theme;
    return mode === 'light' || mode === 'dark' || mode === 'system' ? mode : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 挂载前的主题引导：有快照时按快照解析并应用，返回“已应用”的实际配色；
 * 无快照时不碰 DOM（返回 undefined），让 CSS 的深色媒体查询兜底，避免先写错再纠正。
 */
export function applyCachedTheme(): ResolvedTheme | undefined {
  const mode = readCachedThemeMode();
  if (!mode) return undefined;
  const resolved = resolveTheme(mode, { prefersDark: systemPrefersDark() });
  applyTheme(resolved);
  return resolved;
}

/** 按设置里的主题模式计算并应用（窗口加载完成 / 收到设置变更时调用） */
export function applyThemeMode(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode, { prefersDark: systemPrefersDark() });
  applyTheme(resolved);
  return resolved;
}

/** 读取当前系统偏好（拆出来便于测试注入 matchMedia） */
function currentPrefersDark(win?: Window | null): boolean {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  if (!w || typeof w.matchMedia !== 'function') return false;
  try {
    return w.matchMedia(DARK_QUERY).matches === true;
  } catch {
    return false;
  }
}

/**
 * 系统主题实时跟随：仅当 mode === 'system' 时订阅 prefers-color-scheme 变化，
 * 变化时立刻重新解析并应用，返回取消订阅函数。
 *
 * - 显式选了 light/dark 时不订阅、直接返回空函数（既省回调也避免误改）；
 * - 环境不支持 addEventListener（老 WebView / 测试替身）时静默降级为不订阅；
 * - 调用方负责在组件卸载时取消，或直接用下面的 ThemeFollower。
 */
export function watchSystemTheme(
  mode: ThemeMode,
  win?: Window | null,
  doc?: Document | null,
): () => void {
  const w = win ?? (typeof window !== 'undefined' ? window : null);
  if (mode !== 'system' || !w || typeof w.matchMedia !== 'function') return () => {};
  let mql: MediaQueryList;
  try {
    mql = w.matchMedia(DARK_QUERY);
  } catch {
    return () => {};
  }
  if (typeof mql.addEventListener !== 'function') return () => {};
  const onChange = () =>
    applyTheme(resolveTheme('system', { prefersDark: currentPrefersDark(w) }), doc);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * 跟随系统的“订阅器”：记住当前 mode，mode 变化时自动换订阅（只有 system 才真正挂监听）。
 * 调用 update(mode) 切换档位，调用 stop() 释放；供窗口在设置变更时使用。
 */
export class ThemeFollower {
  #unsubscribe: () => void = () => {};
  #mode: ThemeMode | null = null;
  #win: Window | null;
  #doc: Document | null;

  constructor(win?: Window | null, doc?: Document | null) {
    this.#win = win ?? (typeof window !== 'undefined' ? window : null);
    this.#doc = doc ?? (typeof document !== 'undefined' ? document : null);
  }

  /** 应用并（必要时）订阅；返回实际生效的配色 */
  update(mode: ThemeMode): ResolvedTheme {
    const resolved = applyThemeMode(mode);
    if (mode === this.#mode) return resolved; // 档位没变就不重建订阅
    this.#mode = mode;
    this.#unsubscribe();
    this.#unsubscribe = watchSystemTheme(mode, this.#win, this.#doc);
    return resolved;
  }

  /** 释放订阅（组件卸载 / 窗口关闭时调用） */
  stop(): void {
    this.#unsubscribe();
    this.#unsubscribe = () => {};
    this.#mode = null;
  }
}
