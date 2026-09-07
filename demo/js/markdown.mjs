// markdown.mjs —— 迷你 Markdown 渲染器（演示子集）
// 支持：标题 / 段落 / 粗体 / 斜体 / 行内代码 / 链接 / 引用 / 无序有序列表 /
//       任务列表(- [ ] / - [x]) / 代码围栏(带简易语法高亮) / 分隔线。
// 全部输出前做 HTML 转义，杜绝注入。返回 { html, tasks }，tasks 用于
// 预览里勾选任务后回写源文（元素带 data-offset 记录任务行起始偏移）。

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- 简易语法高亮 ----------
const LANG_ALIAS = {
  js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts',
  python: 'python', py: 'python',
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash',
  rust: 'rust', rs: 'rust', go: 'go', golang: 'go',
  java: 'java', c: 'c', cpp: 'cpp', css: 'css', sql: 'sql',
};

const LANGS = {
  js: { keywords: ['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'yield', 'true', 'false', 'null', 'undefined'], comment: 'slash' },
  ts: { keywords: ['abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class', 'const', 'continue', 'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 'from', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'keyof', 'let', 'new', 'never', 'number', 'of', 'private', 'protected', 'public', 'readonly', 'return', 'static', 'string', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var', 'void', 'while', 'yield', 'true', 'false', 'null', 'undefined', 'unknown'], comment: 'slash' },
  python: { keywords: ['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield'], comment: 'hash' },
  bash: { keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', 'in', 'echo', 'export', 'cd', 'sudo', 'exit', 'return', 'local', 'source', 'set', 'unset', 'printf', 'read', 'test'], comment: 'hash' },
  rust: { keywords: ['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while'], comment: 'slash' },
  go: { keywords: ['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var', 'true', 'false', 'nil'], comment: 'slash' },
  java: { keywords: ['abstract', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null'], comment: 'slash' },
  c: { keywords: ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', 'true', 'false', 'NULL'], comment: 'slash' },
  cpp: { keywords: ['alignas', 'alignof', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'constexpr', 'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'namespace', 'new', 'nullptr', 'operator', 'private', 'protected', 'public', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw', 'true', 'try', 'typedef', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'while'], comment: 'slash' },
  css: { keywords: ['@media', '@keyframes', '@import', '@font-face', 'important'], comment: 'none' },
  sql: { keywords: ['SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AND', 'OR', 'NOT', 'NULL', 'PRIMARY', 'KEY', 'VALUES', 'AS', 'UNION', 'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'], comment: 'slash' },
};

const cache = new Map();
function tokenRegexFor(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const conf = LANGS[lang];
  let re = null;
  if (conf) {
    const parts = [];
    if (conf.comment === 'slash') parts.push('(?<c>\\/\\/[^\\n]*)');
    if (conf.comment === 'hash') parts.push('(?<c>#[^\\n]*)');
    parts.push("(?<s>\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*')");
    const kws = [...conf.keywords].sort((a, b) => b.length - a.length).join('|');
    parts.push(`(?<k>\\b(?:${kws})\\b)`);
    parts.push('(?<n>\\b\\d+(?:\\.\\d+)?\\b)');
    re = new RegExp(parts.join('|'), 'g');
  }
  cache.set(lang, re);
  return re;
}

export function highlightCode(langRaw, code) {
  const lang = LANG_ALIAS[(langRaw || '').trim().toLowerCase()] || '';
  const escaped = escapeHtml(code);
  const re = tokenRegexFor(lang);
  if (!re) return escaped;
  const out = [];
  let last = 0;
  for (const m of escaped.matchAll(re)) {
    out.push(escaped.slice(last, m.index));
    const cls = m.groups.c ? 'tok-c' : m.groups.s ? 'tok-s' : m.groups.k ? 'tok-k' : 'tok-n';
    out.push(`<span class="${cls}">${m[0]}</span>`);
    last = m.index + m[0].length;
  }
  out.push(escaped.slice(last));
  return out.join('');
}

// ---------- 行内格式 ----------
function formatRich(t) {
  let s = escapeHtml(t);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

function inline(line) {
  const parts = line.split(/`([^`\n]+)`/);
  return parts
    .map((p, i) => (i % 2 === 1 ? `<code>${escapeHtml(p)}</code>` : formatRich(p)))
    .join('');
}

// ---------- 主体渲染 ----------
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_TASK = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;
const RE_UL = /^(\s*)[-*+]\s+(.*)$/;
const RE_OL = /^(\s*)\d+\.\s+(.*)$/;
const RE_HR = /^(?:-{3,}|\*{3,}|_{3,})$/;

export function renderMarkdown(md) {
  const lines = String(md || '').split('\n');
  const html = [];
  const tasks = [];
  let lineStart = 0; // 当前行在原文中的起始偏移

  const flushParagraph = (buf) => {
    if (buf.length) {
      html.push(`<p>${buf.map((l) => inline(l)).join('<br>')}</p>`);
      buf.length = 0;
    }
  };

  let para = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const consumed = raw.length + 1; // +1 换行符
    const cur = lineStart;

    // 代码围栏
    if (/^```/.test(raw)) {
      flushParagraph(para);
      const m = raw.match(/^```(\w*)/);
      const lang = m ? m[1] : '';
      const buf = [];
      i += 1;
      lineStart += consumed; // 跳过开头的 ```
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        lineStart += lines[i].length + 1;
        i += 1;
      }
      if (i < lines.length) {
        lineStart += lines[i].length + 1; // 跳过收尾的 ```
        i += 1;
      }
      const code = buf.join('\n');
      html.push(`<pre class="code"><code class="lang-${escapeHtml(lang) || 'plain'}">${highlightCode(lang, code)}</code></pre>`);
      continue;
    }

    // 标题
    const hm = raw.match(RE_HEADING);
    if (hm) {
      flushParagraph(para);
      const level = hm[1].length;
      html.push(`<h${level}>${inline(hm[2])}</h${level}>`);
      i += 1; lineStart += consumed;
      continue;
    }

    // 分隔线
    if (RE_HR.test(raw.trim()) && raw.trim().length >= 3) {
      flushParagraph(para);
      html.push('<hr>');
      i += 1; lineStart += consumed;
      continue;
    }

    // 引用
    if (/^>\s?/.test(raw)) {
      flushParagraph(para);
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
        lineStart += lines[i - 1].length + 1;
      }
      html.push(`<blockquote>${buf.map((l) => `<p>${inline(l)}</p>`).join('')}</blockquote>`);
      continue;
    }

    // 任务列表（一行行收集，连续的项并入同一 <ul>）
    if (RE_TASK.test(raw)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && RE_TASK.test(lines[i])) {
        const line = lines[i];
        const tm = line.match(RE_TASK);
        const indent = tm[1];
        const off = lineStart + indent.length;
        const checked = tm[2] !== ' ';
        tasks.push({ offset: off, checked });
        items.push(
          `<li class="task${checked ? ' done' : ''}"><label>` +
            `<input type="checkbox" data-offset="${off}" ${checked ? 'checked' : ''}>` +
            `<span>${inline(tm[3])}</span></label></li>`
        );
        i += 1;
        lineStart += line.length + 1;
      }
      html.push(`<ul class="task-list">${items.join('')}</ul>`);
      continue;
    }

    // 无序列表
    if (RE_UL.test(raw)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && RE_UL.test(lines[i])) {
        const um = lines[i].match(RE_UL);
        items.push(`<li>${inline(um[2])}</li>`);
        i += 1;
        lineStart += lines[i - 1].length + 1;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // 有序列表
    if (RE_OL.test(raw)) {
      flushParagraph(para);
      const items = [];
      while (i < lines.length && RE_OL.test(lines[i])) {
        const om = lines[i].match(RE_OL);
        items.push(`<li>${inline(om[2])}</li>`);
        i += 1;
        lineStart += lines[i - 1].length + 1;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // 空行 → 段落结束
    if (/^\s*$/.test(raw)) {
      flushParagraph(para);
      i += 1; lineStart += consumed;
      continue;
    }

    // 普通文本行
    para.push(raw);
    i += 1; lineStart += consumed;
  }
  flushParagraph(para);

  return { html: html.join(''), tasks };
}
