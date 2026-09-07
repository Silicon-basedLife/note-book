// actions.ts —— 动作注册表（对应 docs/TECH_DESIGN.md §5.3 / ROADMAP 快捷键注册机制预留）
// Core 维护动作表：应用内快捷键（P0）与未来系统级全局热键（P1）最终都映射到同一批动作；
// P1 只追加映射、不重构。run 回调由调用方（UI 层）注入，注册表本身与运行环境无关、可单测。

export interface Shortcut {
  /** 主键：单字符或键名（'k'、's'、'Escape'、'?' 等） */
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export interface ActionDef {
  id: string;
  /** 展示名（帮助面板等） */
  label: string;
  /** 描述（可选，预留用于自定义快捷键设置页） */
  description?: string;
  shortcut?: Shortcut;
  run: () => void | Promise<void>;
}

export type RegisterResult = { ok: true } | { ok: false; reason: string };

/** 键盘事件的最小可测试视图（UI 传入真实 KeyboardEvent 的对应字段） */
export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function shortcutId(s: Shortcut): string {
  const mods = [
    s.ctrl ? 'C' : '',
    s.alt ? 'A' : '',
    s.shift ? 'S' : '',
    s.meta ? 'M' : '',
  ].join('');
  return `${mods}+${normalizeKey(s.key)}`;
}

export class ActionRegistry {
  private defs = new Map<string, ActionDef>();
  private byShortcut = new Map<string, string>();

  /** 注册动作；重复 id 或快捷键冲突返回原因（P0 验收：热键冲突有提示） */
  register(def: ActionDef): RegisterResult {
    if (this.defs.has(def.id)) {
      return { ok: false, reason: `动作「${def.id}」已注册` };
    }
    if (def.shortcut) {
      const sid = shortcutId(def.shortcut);
      const owner = this.byShortcut.get(sid);
      if (owner && owner !== def.id) {
        return { ok: false, reason: `快捷键与「${owner}」冲突` };
      }
      this.byShortcut.set(sid, def.id);
    }
    this.defs.set(def.id, def);
    return { ok: true };
  }

  unregister(id: string): boolean {
    const def = this.defs.get(id);
    if (!def) return false;
    if (def.shortcut) this.byShortcut.delete(shortcutId(def.shortcut));
    this.defs.delete(id);
    return true;
  }

  get(id: string): ActionDef | undefined {
    return this.defs.get(id);
  }

  list(): ActionDef[] {
    return [...this.defs.values()];
  }

  /** 依据键盘事件匹配动作（修饰键需完全一致） */
  match(event: KeyEventLike): ActionDef | undefined {
    const candidates = [...this.byShortcut.keys()].filter((sid) => {
      const [mods, key] = splitSid(sid);
      const pressed = mods;
      const want = (event.ctrlKey ? 'C' : '') + (event.altKey ? 'A' : '') + (event.shiftKey ? 'S' : '') + (event.metaKey ? 'M' : '');
      return pressed === want && key === normalizeKey(event.key);
    });
    if (candidates.length === 0) return undefined;
    const id = this.byShortcut.get(candidates[0]!);
    return id ? this.defs.get(id) : undefined;
  }
}

function splitSid(sid: string): [string, string] {
  const plus = sid.lastIndexOf('+');
  if (plus < 0) return ['', sid];
  return [sid.slice(0, plus), sid.slice(plus + 1)];
}
