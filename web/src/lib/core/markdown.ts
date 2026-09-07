// markdown.ts —— Markdown 渲染管线（对应 docs/TECH_DESIGN.md §4）
// markdown-it + GFM（表格/删除线/链接化）+ highlight.js 语法高亮 + 白名单输出清洗。
// 待办列表由自定义 core 规则实现：勾选框带 data-offset（指向源文任务行 "-" 的字符偏移），
// 预览点击后经 core.toggleTask 回写源文（demo 交互语义的平移 + 测试迁移）。
import MarkdownIt from 'markdown-it';
import type { LanguageFn } from 'highlight.js';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { escapeAttr, escapeHtml } from './html.ts';
import type { TaskMarker } from './tasks.ts';

export { escapeHtml };

// ---------- 语法高亮（hljs 注册常见语言，覆盖 demo 能力集） ----------
const REGISTERED: Array<[string, LanguageFn]> = [
  ['javascript', javascript],
  ['typescript', typescript],
  ['python', python],
  ['bash', bash],
  ['rust', rust],
  ['go', go],
  ['java', java],
  ['c', c],
  ['cpp', cpp],
  ['css', css],
  ['sql', sql],
  ['json', json],
  ['markdown', markdown],
  ['xml', xml],
  ['yaml', yaml],
];
for (const [name, fn] of REGISTERED) hljs.registerLanguage(name, fn);

/** 高亮代码；未知语言回退为纯转义文本 */
export function highlightCode(langRaw: string, code: string): string {
  const lang = (langRaw || '').trim().toLowerCase();
  if (!lang) return escapeHtml(code);
  try {
    if (!hljs.getLanguage(lang)) return escapeHtml(code);
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

// ---------- 待办列表：注入可勾选 checkbox（data-offset 对齐源文） ----------
const MARKER_RE = /[-*+]\s+\[([ xX])\]\s/;

interface TaskEnv {
  tasks: TaskMarker[];
}

/** 计算源码每行在全文中的起始字符偏移 */
function lineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'noteapp_task_lists', (state) => {
    const env = state.env as TaskEnv;
    const starts = lineStarts(state.src);
    const lines = state.src.split('\n');
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (!token || token.type !== 'list_item_open' || !token.map) continue;
      const lineNo = token.map[0];
      const line = lines[lineNo];
      if (line === undefined) continue;
      const m = MARKER_RE.exec(line);
      if (!m) continue;
      const checked = m[1] !== ' ';
      const offset = (starts[lineNo] ?? 0) + m.index;

      // 定位该列表项首个 inline token，其首文本子节点以 "[ ] "/"[x] " 开头
      let inline: { children: unknown[] | null } | null = null;
      for (let j = i + 1; j < state.tokens.length; j++) {
        const t = state.tokens[j];
        if (!t) break;
        if (t.type === 'list_item_close') break;
        if (t.type === 'inline' && !inline) {
          const first = (t.children ?? [])[0];
          if (first && first.type === 'text' && /^\[[ xX]\]\s/.test(first.content)) {
            inline = t;
            break;
          }
        }
      }
      if (!inline || !inline.children || inline.children.length === 0) continue;
      const first = inline.children[0] as { type: string; content: string };
      first.content = first.content.replace(/^\[[ xX]\]\s/, '');
      if (first.content === '') inline.children.shift();
      // html_inline：对象字面量即可满足渲染需要（type/tag/nesting/content）
      inline.children.unshift({
        type: 'html_inline',
        tag: '',
        nesting: 0,
        level: 0,
        content: `<input class="task-check" type="checkbox" data-offset="${offset}"${checked ? ' checked' : ''}>`,
        children: null,
        attrs: null,
        map: null,
        markup: '',
        info: '',
        meta: null,
        block: false,
        hidden: false,
      } as unknown as (typeof inline.children)[number]);
      env.tasks.push({ offset, checked });
    }
  });
}

// ---------- 输出清洗（白名单，第二道防线） ----------
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'span', 'strong', 'em', 'del', 'mark', 'sup', 'sub',
  'a', 'img', 'input', 'b', 'i', 'u', 's',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'dl', 'dt', 'dd',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input']);
/** 允许的属性：tag → 属性白名单；'' 表示任意 tag 通用 */
const ATTR_ALLOW: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  input: new Set(['type', 'class', 'checked', 'data-offset']),
  code: new Set(['class']),
  span: new Set(['class']),
  pre: new Set(['class']),
  li: new Set(['class']),
  th: new Set(['align']),
  td: new Set(['align']),
};
const ALWAYS_ATTRS = new Set(['class']);

function attrValueSafe(name: string, value: string): boolean {
  if (name === 'href' || name === 'src') {
    const v = value.trim().toLowerCase();
    return (
      v.startsWith('http://') || v.startsWith('https://') || v.startsWith('mailto:') ||
      v.startsWith('#') || v.startsWith('/') || v === ''
    );
  }
  return !/[<>"'`]/.test(value);
}

/** 白名单输出清洗：删除未允许标签与属性（用于 markdown 渲染结果的安全兜底） */
export function sanitizeHtml(html: string): string {
  let out = '';
  let last = 0;
  const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out += html.slice(last, m.index);
    last = m.index + m[0].length;
    const raw = m[0];
    if (raw.startsWith('<!--')) continue; // 丢弃注释
    const closing = raw.startsWith('</');
    const tagMatch = /^<\/?([a-zA-Z0-9]+)/.exec(raw);
    if (!tagMatch) continue;
    const tag = tagMatch[1]!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
      continue;
    }
    const allow = ATTR_ALLOW[tag] ?? new Set<string>();
    const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    const parts: string[] = [`<${tag}`];
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(raw))) {
      const name = a[1]!.toLowerCase();
      const value = (a[3] ?? a[4] ?? a[5] ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (!allow.has(name) && !ALWAYS_ATTRS.has(name)) continue;
      if (!attrValueSafe(name, value)) continue;
      parts.push(` ${name}="${escapeAttr(value)}"`);
    }
    // 布尔属性 checked（无值形式）
    if (tag === 'input' && /\bchecked(?:\s|>)/.test(raw) && !parts.some((p) => p.startsWith(' checked'))) {
      parts.push(' checked');
    }
    parts.push('>');
    out += parts.join('');
  }
  out += html.slice(last);
  return out;
}

// ---------- 渲染器装配 ----------
function createRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight(code, lang) {
      const safeLang = (lang || '').trim();
      const langClass = safeLang ? ` lang-${escapeAttr(safeLang)}` : '';
      const body = highlightCode(safeLang, code);
      return `<pre class="code"><code class="hljs${langClass}">${body}</code></pre>`;
    },
  });
  taskListPlugin(md);
  return md;
}

let mdInstance: MarkdownIt | undefined;
function renderer(): MarkdownIt {
  mdInstance ??= createRenderer();
  return mdInstance;
}

export interface RenderResult {
  /** 已清洗、可安全 innerHTML 的 HTML */
  html: string;
  /** 待办任务（含源文偏移与勾选态），按文档顺序 */
  tasks: TaskMarker[];
}

/** 渲染 Markdown → { html, tasks }。注入脚本/事件属性一律被转义或白名单剔除。 */
export function renderMarkdown(mdText: string): RenderResult {
  const env: TaskEnv = { tasks: [] };
  const raw = renderer().render(mdText || '', env);
  return { html: sanitizeHtml(raw), tasks: env.tasks };
}
