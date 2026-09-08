// dock-core.ts —— 侧边吸附/隐藏的纯计算（与 Tauri API 解耦，便于单测）
export type DockSide = 'left' | 'right';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}

/** 窗口当前是否接近某条屏幕边缘（决定吸附） */
export function nearSnap(win: Rect, area: Rect, snapPx: number): DockSide | null {
  const dl = Math.abs(win.x - area.x);
  const dr = Math.abs(win.x + win.w - (area.x + area.w));
  if (dl <= dr && dl <= snapPx) return 'left';
  if (dr <= snapPx) return 'right';
  return null;
}

/** 停靠后窗口的 X：左贴 area.x，右贴 area 右缘 */
export function snapX(side: DockSide, win: Rect, area: Rect): number {
  return side === 'left' ? area.x : area.x + area.w - win.w;
}

/** 隐藏时把窗口完全移出屏幕的 X（左 → 屏幕左边外；右 → 屏幕右边外） */
export function hiddenX(side: DockSide, win: Rect, area: Rect, margin = 4): number {
  return side === 'left' ? area.x - win.w - margin : area.x + area.w + margin;
}

/** 光标是否进入停靠侧的屏幕边缘热区（用于唤出） */
export function inHotZone(cursor: Point, side: DockSide, area: Rect, zonePx: number): boolean {
  const edgeX = side === 'left' ? area.x : area.x + area.w;
  if (Math.abs(cursor.x - edgeX) > zonePx) return false;
  return cursor.y >= area.y - 4 && cursor.y <= area.y + area.h + 4;
}

/** 已停靠但窗口被拖离超过容差 → 判定取消停靠 */
export function unhooked(win: Rect, side: DockSide, area: Rect, tolerance: number): boolean {
  if (side === 'left') return Math.abs(win.x - area.x) > tolerance;
  return Math.abs(win.x + win.w - (area.x + area.w)) > tolerance;
}
