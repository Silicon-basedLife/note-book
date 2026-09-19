// markdown-it-mark 没有自带类型声明，这里补一个最小可用的（只用到默认导出的插件函数）
declare module 'markdown-it-mark' {
  import type MarkdownIt from 'markdown-it';
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}
