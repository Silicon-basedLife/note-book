// core.text —— 待办勾选回写 / 相对时间 等纯函数
import test from 'node:test';
import assert from 'node:assert/strict';
import { isTaskMarkerAt, toggleTask } from '../web/src/lib/core/tasks.ts';
import { relativeTime } from '../web/src/lib/core/format.ts';

test('toggleTask：勾选与取消、越界与非法位置保护', () => {
  const body = '- [ ] 待办一\n- [x] 待办二\n正文';
  assert.equal(toggleTask(body, 0), '- [x] 待办一\n- [x] 待办二\n正文');
  assert.equal(toggleTask('- [x] 待办一\n- [x] 待办二\n正文', 0), body);
  assert.equal(toggleTask(body, 10), '- [ ] 待办一\n- [ ] 待办二\n正文'); // 第二行 '-' 偏移
  assert.equal(toggleTask(body, 99), body); // 越界不动
  assert.equal(toggleTask(body, 15), body); // 非任务位置不动
  assert.equal(toggleTask('普通文本', 0), '普通文本');
});

test('toggleTask：支持 * 列表与 X 大写，字符回退空格', () => {
  assert.equal(toggleTask('* [ ] 用星号', 0), '* [x] 用星号');
  assert.equal(toggleTask('- [X] 大写已完成', 0), '- [ ] 大写已完成');
});

test('toggleTask：非字符串/非整数入参原样返回', () => {
  assert.equal(toggleTask('abc', 1.5), 'abc');
  assert.equal(toggleTask('abc', NaN), 'abc');
});

test('isTaskMarkerAt：识别行首任务标记', () => {
  assert.ok(isTaskMarkerAt('- [ ] a', 0));
  assert.ok(isTaskMarkerAt('- [x] b', 0));
  assert.ok(isTaskMarkerAt('前文\n- [ ] c', 3)); // 换行后行首偏移
  assert.ok(!isTaskMarkerAt('- [x] b', 2)); // 从标记中间起算不是任务行
  assert.ok(!isTaskMarkerAt('', 0));
  assert.ok(!isTaskMarkerAt('- [ ] a', 99)); // 越界
});

test('relativeTime：常用粒度（含"刚刚/昨天"）', () => {
  const now = new Date('2025-06-10T09:00:00.000Z').getTime();
  assert.equal(relativeTime(new Date(now - 30 * 1000).toISOString(), now), '刚刚');
  assert.equal(relativeTime(new Date(now - 5 * 60 * 1000).toISOString(), now), '5 分钟前');
  assert.equal(relativeTime(new Date(now - 3 * 3600 * 1000).toISOString(), now), '3 小时前');
  assert.equal(relativeTime(new Date(now - 26 * 3600 * 1000).toISOString(), now), '昨天');
  assert.equal(relativeTime(new Date(now - 3 * 86400 * 1000).toISOString(), now), '3 天前');
});
