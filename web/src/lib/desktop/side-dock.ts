// side-dock.ts —— QQ 式侧边吸附 + 缩进/唤出（仅 Tauri 桌面运行；Web 预览不实例化）
// 规则（按已确认规格）：
//   - 仅“图3 侧栏态”生效：App 在面板展开时调用 deactivate() 取消停靠；
//   - 窗口拖到屏幕左/右边缘 ≤24px → 贴边停靠并置顶；
//   - 停靠后鼠标离开窗口 3s → 完全滑出屏幕（隐藏）；
//   - 光标进入停靠侧屏幕边缘热区 → 滑回显示；
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

const SNAP_PX = 24;       // 距边缘多少以内触发吸附（逻辑像素）
const HOT_ZONE_PX = 12;   // 屏幕边缘唤出热区宽度
const HIDE_DELAY_MS = 3000;
const POLL_MS = 100;
const UNHOOK_TOL = 64;    // 停靠后拖离多少判定为取消停靠

export class SideDock {
  private win = getCurrentWindow();
  private active = false;
  private docked: DockSide | null = null;
  private hidden = false;
  private mouseIn = true;
  private area: Rect | null = null;
  private scale = 1;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  /** 启动停靠管理（图3 侧栏态时调用） */
  activate(): void {
    if (this.active) return;
    this.active = true;
    if (!this.interval) {
      this.interval = setInterval(() => { void this.tick(); }, POLL_MS);
    }
  }

  /** 停止停靠（展开到图4/图5、卸载时调用）：恢复置顶状态并回到可视位置 */
  deactivate(): void {
    if (!this.active && !this.docked && !this.hidden) return;
    this.active = false;
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    void this.undock();
  }

  setMouseInside(inside: boolean): void {
    this.mouseIn = inside;
    if (!this.active) return;
    if (this.docked && !this.hidden) this.manageHide();
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
      // 尚未停靠：靠近边缘则吸附
      if (!this.docked) {
        const side = nearSnap(g.win, g.area, SNAP_PX);
        if (!side) return;
        await this.win.setPosition(new LogicalPosition(snapX(side, g.win, g.area), g.win.y));
        this.docked = side;
        await this.setTop(true);
        return;
      }
      // 已停靠：被拖离 → 取消停靠
      if (unhooked(g.win, this.docked, g.area, UNHOOK_TOL)) {
        await this.undock();
        return;
      }
      // 已停靠：按鼠标位置管理隐藏计时
      this.manageHide();
    } finally {
      this.busy = false;
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

  private manageHide(): void {
    if (!this.docked || this.hidden) return;
    if (this.mouseIn) {
      if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
      return;
    }
    if (!this.hideTimer) {
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        void this.hideNow();
      }, HIDE_DELAY_MS);
    }
  }

  private async hideNow(): Promise<void> {
    if (!this.docked || this.hidden) return;
    const g = await this.geometry();
    const area = this.area ?? g?.area;
    if (!area || !g) return;
    this.hidden = true;
    const x = hiddenX(this.docked, g.win, area, 4);
    try { await this.win.setPosition(new LogicalPosition(x, g.win.y)); } catch { /* ignore */ }
  }

  private async watchHidden(): Promise<void> {
    if (!this.docked || !this.area) return;
    try {
      const cp = await cursorPosition();
      const cur = { x: cp.x / this.scale, y: cp.y / this.scale };
      if (inHotZone(cur, this.docked, this.area, HOT_ZONE_PX)) {
        await this.showNow();
      }
    } catch { /* 光标读取失败则静默重试 */ }
  }

  private async showNow(): Promise<void> {
    if (!this.docked) return;
    const g = await this.geometry();
    const area = this.area ?? g?.area;
    if (!area || !g) return;
    this.hidden = false;
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    try { await this.win.setPosition(new LogicalPosition(snapX(this.docked, g.win, area), g.win.y)); } catch { /* ignore */ }
  }

  private async setTop(on: boolean): Promise<void> {
    try { await this.win.setAlwaysOnTop(on); } catch { /* ignore */ }
  }

  private async undock(): Promise<void> {
    const side = this.docked;
    const wasHidden = this.hidden;
    if (side && wasHidden && this.area) {
      // 隐藏中取消停靠：先滑回停靠位再解除，避免窗口滞留在屏外
      const g = await this.geometry();
      if (g) {
        try { await this.win.setPosition(new LogicalPosition(snapX(side, g.win, this.area), g.win.y)); } catch { /* ignore */ }
      }
    }
    this.docked = null;
    this.hidden = false;
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    await this.setTop(false);
  }
}
