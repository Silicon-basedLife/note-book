// dock-core 单元测试：吸附/隐藏坐标/热区/脱离判定
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hiddenX, inHotZone, nearSnap, snapX, unhooked,
} from '../web/src/lib/desktop/dock-core.ts';

const area = { x: 0, y: 0, w: 1920, h: 1040 };

test('nearSnap：仅越界/接触边缘才吸附（无屏内磁吸）', () => {
  // 屏幕内侧不吸附
  assert.equal(nearSnap({ x: 12, y: 100, w: 232, h: 760 }, area), null);
  assert.equal(nearSnap({ x: 300, y: 100, w: 232, h: 760 }, area), null);
  assert.equal(nearSnap({ x: 1920 - 232 - 14, y: 100, w: 232, h: 760 }, area), null);
  // 接触边界（0px）→ 吸附
  assert.equal(nearSnap({ x: 0, y: 0, w: 232, h: 100 }, area), 'left');
  assert.equal(nearSnap({ x: 1920 - 232, y: 0, w: 232, h: 100 }, area), 'right');
  // 已越过左侧 → 左
  assert.equal(nearSnap({ x: -80, y: 0, w: 232, h: 100 }, area), 'left');
  assert.equal(nearSnap({ x: -400, y: 0, w: 232, h: 100 }, area), 'left');
  // 已越过右侧 → 右
  assert.equal(nearSnap({ x: 1920 - 232 + 60, y: 0, w: 232, h: 100 }, area), 'right');
  assert.equal(nearSnap({ x: 1920 + 200, y: 0, w: 232, h: 100 }, area), 'right');
  // 两侧同时越过 → 取越界更远的一侧
  const wide = { x: -50, y: 0, w: 2100, h: 100 }; // 左侧越 50，右侧越 180-？ => 右越界更多
  assert.equal(nearSnap(wide, area), 'right');
});

test('snapX：左贴边/右贴边', () => {
  const win = { x: 12, y: 5, w: 232, h: 760 };
  assert.equal(snapX('left', win, area), 0);
  assert.equal(snapX('right', win, area), 1920 - 232);
});

test('hiddenX：完全移出屏幕（含安全边距）', () => {
  const win = { x: 0, y: 0, w: 232, h: 760 };
  assert.equal(hiddenX('left', win, area, 4), -232 - 4);
  assert.equal(hiddenX('right', win, area, 4), 1920 + 4);
});

test('inHotZone：仅在停靠侧边缘热区命中', () => {
  assert.ok(inHotZone({ x: 6, y: 300 }, 'left', area, 12));
  assert.ok(inHotZone({ x: 1920 - 6, y: 300 }, 'right', area, 12));
  assert.ok(!inHotZone({ x: 60, y: 300 }, 'left', area, 12));
  assert.ok(!inHotZone({ x: 1920 - 60, y: 300 }, 'right', area, 12));
  assert.ok(!inHotZone({ x: 6, y: -30 }, 'left', area, 12)); // 超出工作区纵向范围
});

test('unhooked：拖离超过容差才解除停靠', () => {
  const win = { x: 0, y: 0, w: 232, h: 760 };
  assert.equal(unhooked(win, 'left', area, 60), false);
  assert.equal(unhooked({ ...win, x: 80 }, 'left', area, 60), true);
  const winR = { x: 1920 - 232, y: 0, w: 232, h: 760 };
  assert.equal(unhooked(winR, 'right', area, 60), false);
  assert.equal(unhooked({ ...winR, x: 1920 - 232 + 90 }, 'right', area, 60), true);
});
