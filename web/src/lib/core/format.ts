// format.ts —— 展示辅助（与 UI 解耦的纯函数）
/** 相对时间中文展示（含"刚刚/昨天"粒度） */
export function relativeTime(isoStr: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(isoStr).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return '刚刚';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d === 1) return '昨天';
  if (d < 7) return `${d} 天前`;
  return new Date(isoStr).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
