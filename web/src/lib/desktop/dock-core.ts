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

/** 判定吸附侧：窗口边框“接触(=0)或超过屏幕边界”即吸附；
 *  同时保留“仍在屏幕内侧但距边缘 ≤ snapPx”的磁吸手感。
 *  两侧同时满足时取更贴边界的一侧。 */
export function nearSnap(win: Rect, area: Rect, snapPx: number): DockSide | null {
  const mL = win.x - area.x;                                        // 左缘偏差：0=接触，负=已超出左侧
  const mR = win.x + win.w - (area.x + area.w);                     // 右缘偏差：0=接触，正=已超出右侧
  const okL = mL <= snapPx;
  const okR = mR >= -snapPx;
  if (okL && okR) return Math.abs(mL) <= Math.abs(mR) ? 'left' : 'right';
  if (okL) return 'left';
  if (okR) return 'right';
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
