// side-dock.ts —— QQ 式侧边吸附 + 缩进/唤出（仅 Tauri 桌面运行；Web 预览不实例化）
// 规则（按已确认规格）：
//   - 仅“图3 侧栏态”生效：App 在面板展开时调用 deactivate() 取消停靠；
//   - 窗口边框接触或越过屏幕左/右边界 → 贴边停靠并置顶；
//   - 停靠后通过“全局鼠标位置”判断鼠标离开窗口满 3 秒 → 平滑滑出屏幕（隐藏）；
//   - 光标进入停靠侧屏幕边缘热区 → 平滑滑回显示；
//   - 窗口被拖离边缘超过容差 → 取消停靠（并关闭置顶）。
import { currentMonitor, cursorPosition, getCurrentWindow, LogicalPosition } from '@tauri-apps/api/window';
import {
  type DockSide,
  type Rect,
  hiddenX,
  inHotZone,
  nearSnap,
  snapX,
  unhooked,
} from './dock-core.ts';

const HIDE_DELAY_MS = 3000;  // 鼠标离开窗口后多久缩进
const POLL_MS = 100;         // 位置/光标轮询周期
const HOT_ZONE_PX = 14;      // 屏幕边缘唤出热区宽度
const UNHOOK_TOL = 80;       // 停靠后拖离多少判定为取消停靠
const MOVE_TOL = 1;          // 判定窗口是否仍在移动（拖拽中不缩进）

export class SideDock {
  private win = getCurrentWindow();
  private active = false;
  private docked: DockSide | null = null;
  private hidden = false;
  private area: Rect | null = null;
  private scale = 1;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private lastX = 0;
  private lastY = 0;

  /** 启动停靠管理（图3 侧栏态时调用） */
  activate(): void {
    if (this.active) return;
    this.active = true;
    if (!this.interval) {
      this.interval = setInterval(() => { void this.tick(); }, POLL_MS);
    }
  }

  /** 停止停靠（展开到图4/图5、卸载时调用）：恢复置顶并回到可视位置 */
  deactivate(): void {
    if (!this.active && !this.docked && !this.hidden) return;
    this.active = false;
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    void this.undock();
  }

  destroy(): void {
    this.deactivate();
  }

  // ---------- 内部 ----------

  private async tick(): Promise<void> {
    if (!this.active || this.busy) return;
    this.busy = true;
    try {
      if (this.hidden) { await this.watchHidden(); return; }
      const g = await this.geometry();
      if (!g) return;
      this.area = g.area;

      // 1) 未停靠：边框接触/越过屏幕边界 → 吸附
      if (!this.docked) {
        const side = nearSnap(g.win, g.area);
        if (!side) return;
        await this.win.setPosition(new LogicalPosition(snapX(side, g.win, g.area), g.win.y));
        this.docked = side;
        await this.setTop(true);
        this.lastX = snapX(side, g.win, g.area);
        this.lastY = g.win.y;
        return;
      }

      // 2) 已停靠：被拖离边缘 → 取消停靠
      if (unhooked(g.win, this.docked, g.area, UNHOOK_TOL)) {
        await this.undock();
        return;
      }

      // 3) 已停靠且稳定：依据鼠标位置管理缩进
      const moving = Math.abs(g.win.x - this.lastX) >= MOVE_TOL || Math.abs(g.win.y - this.lastY) >= MOVE_TOL;
      this.lastX = g.win.x;
      this.lastY = g.win.y;
      const inside = await this.cursorInside(g.win);
      if (moving || inside) {
        this.clearHideTimer(); // 拖拽中或鼠标仍在窗口内 → 不缩进
      } else if (!this.hideTimer) {
        this.hideTimer = setTimeout(() => {
          this.hideTimer = null;
          void this.slideOut();
        }, HIDE_DELAY_MS);
      }
    } finally {
      this.busy = false;
    }
  }

  private async cursorInside(win: Rect): Promise<boolean> {
    try {
      const cp = await cursorPosition();
      const cx = cp.x / this.scale;
      const cy = cp.y / this.scale;
      return cx >= win.x - 2 && cx <= win.x + win.w + 2 && cy >= win.y - 2 && cy <= win.y + win.h + 2;
    } catch {
      return true; // 读不到光标时不误隐藏
    }
  }

  private async geometry(): Promise<{ area: Rect; win: Rect } | null> {
    try {
      const m = await currentMonitor();
      if (!m) return null;
      const s = m.scaleFactor || 1;
      this.scale = s;
      const p = await this.win.outerPosition();
      const sz = await this.win.outerSize();
      return {
        area: {
          x: m.workArea.position.x / s,
          y: m.workArea.position.y / s,
          w: m.workArea.size.width / s,
          h: m.workArea.size.height / s,
        },
        win: {
          x: p.x / s,
          y: p.y / s,
          w: sz.width / s,
          h: sz.height / s,
        },
      };
    } catch {
      return null;
    }
  }

  /** 平滑把窗口从当前 X 移动到目标 X（保持 Y 不变） */
  private async slideX(targetX: number, y: number): Promise<void> {
    const g = await this.geometry();
    if (!g) return;
    const from = g.win.x;
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(from + (targetX - from) * t);
      try { await this.win.setPosition(new LogicalPosition(x, y)); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 28));
    }
  }

  private async slideOut(): Promise<void> {
    if (!this.docked || this.hidden) return;
    const g = await this.geometry();
    const area = this.area ?? g?.area;
    if (!area || !g) return;
    this.hidden = true;
    const x = hiddenX(this.docked, g.win, area, 4);
    await this.slideX(x, g.win.y);
  }

  private async watchHidden(): Promise<void> {
    if (!this.docked || !this.area) return;
    try {
      const cp = await cursorPosition();
      const cur = { x: cp.x / this.scale, y: cp.y / this.scale };
      if (inHotZone(cur, this.docked, this.area, HOT_ZONE_PX)) {
        await this.slideBack();
      }
    } catch { /* 光标读取失败则静默重试 */ }
  }

  private async slideBack(): Promise<void> {
    if (!this.docked) return;
    const g = await this.geometry();
    const area = this.area ?? g?.area;
    if (!area || !g) return;
    this.hidden = false;
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    const x = snapX(this.docked, g.win, area);
    await this.slideX(x, g.win.y);
  }

  private clearHideTimer(): void {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
  }

  private async setTop(on: boolean): Promise<void> {
    try { await this.win.setAlwaysOnTop(on); } catch { /* ignore */ }
  }

  private async undock(): Promise<void> {
    const side = this.docked;
    const wasHidden = this.hidden;
    if (side && wasHidden && this.area) {
      // 隐藏中取消停靠：先滑回停靠位再解除
      const g = await this.geometry();
      if (g) {
        try {
          const x = snapX(side, g.win, this.area);
          await this.slideX(x, g.win.y);
        } catch { /* ignore */ }
      }
    }
    this.docked = null;
    this.hidden = false;
    this.clearHideTimer();
    await this.setTop(false);
  }
}
