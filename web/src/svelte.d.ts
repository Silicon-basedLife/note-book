// Svelte 组件声明 shim（tsc 不解析 .svelte，由 vite-plugin-svelte 编译；
// 真实组件类型检查由 svelte-check 负责，此处仅让 tsc --noEmit 可通过）。
declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}
