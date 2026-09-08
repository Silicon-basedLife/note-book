// dock-core 单元测试：吸附/隐藏坐标/热区/脱离判定
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hiddenX, inHotZone, nearSnap, snapX, unhooked,
} from '../web/src/lib/desktop/dock-core.ts';

const area = { x: 0, y: 0, w: 1920, h: 1040 };

test('nearSnap：接触(=0)或超出屏幕边缘即吸附，内侧仍保留磁吸', () => {
  assert.equal(nearSnap({ x: 12, y: 100, w: 232, h: 760 }, area, 24), 'left');
  assert.equal(nearSnap({ x: 1920 - 232 - 14, y: 100, w: 232, h: 760 }, area, 24), 'right');
  assert.equal(nearSnap({ x: 300, y: 100, w: 232, h: 760 }, area, 24), null);
  // 距左 10px、距右 20px → 选左
  assert.equal(nearSnap({ x: 10, y: 0, w: 1920 - 20 - 10, h: 100 }, area, 24), 'left');
  // 接触边界（0px）
  assert.equal(nearSnap({ x: 0, y: 0, w: 232, h: 100 }, area, 24), 'left');
  assert.equal(nearSnap({ x: 1920 - 232, y: 0, w: 232, h: 100 }, area, 24), 'right');
  // 已超出左侧 → 左
  assert.equal(nearSnap({ x: -80, y: 0, w: 232, h: 100 }, area, 24), 'left');
  assert.equal(nearSnap({ x: -400, y: 0, w: 232, h: 100 }, area, 24), 'left');
  // 已超出右侧 → 右
  assert.equal(nearSnap({ x: 1920 - 232 + 60, y: 0, w: 232, h: 100 }, area, 24), 'right');
  assert.equal(nearSnap({ x: 1920 + 200, y: 0, w: 232, h: 100 }, area, 24), 'right');
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
