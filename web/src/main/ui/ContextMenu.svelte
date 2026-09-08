<script lang="ts">
  // ContextMenu.svelte —— 通用右键/上下文菜单
  import { onMount } from 'svelte';

  export interface MenuItem {
    id: string;
    label: string;
    icon?: string;
    danger?: boolean;
    disabled?: boolean;
    onClick: () => void;
  }
  type Row = MenuItem | { type: 'sep' };

  let { x, y, rows, onClose }: { x: number; y: number; rows: Row[]; onClose: () => void } = $props();
  let el = $state<HTMLDivElement | null>(null);

  onMount(() => {
    const onDown = (e: MouseEvent) => {
      if (el && !el.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    const onCtxElse = () => onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onCtxElse, true);
    // 定位：尽量不出视口
    requestAnimationFrame(() => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const nx = Math.min(x, window.innerWidth - r.width - 8);
      const ny = Math.min(y, window.innerHeight - r.height - 8);
      el.style.left = `${Math.max(4, nx)}px`;
      el.style.top = `${Math.max(4, ny)}px`;
    });
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', onCtxElse, true);
    };
  });

  function pick(item: Row) {
    if (item.type === 'sep' || item.disabled) return;
    const m = item as MenuItem;
    m.onClick();
    onClose();
  }
</script>

<div
  class="ctx-menu"
  role="menu"
  tabindex="-1"
  bind:this={el}
  style="left:{x}px; top:{y}px"
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each rows as row, i (i)}
    {#if row.type === 'sep'}
      <div class="ctx-sep"></div>
    {:else}
      <button
        class="ctx-item"
        class:danger={row.danger}
        class:disabled={row.disabled}
        role="menuitem"
        disabled={row.disabled}
        onclick={() => pick(row)}
      >
        {#if row.icon}<span class="ctx-ico">{row.icon}</span>{/if}
        <span>{row.label}</span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .ctx-menu {
    position: fixed;
    z-index: 80;
    min-width: 176px;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 10px 32px rgba(15, 23, 42, 0.18);
    padding: 5px;
    font-size: 13px;
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border-radius: 7px;
    text-align: left;
    color: var(--text);
  }
  .ctx-item:hover:not(.disabled) { background: #eef2f7; }
  .ctx-item.danger { color: var(--danger); }
  .ctx-item.danger:hover { background: #fdecee; }
  .ctx-item.disabled { opacity: 0.45; cursor: default; }
  .ctx-ico { width: 16px; text-align: center; font-size: 13px; }
  .ctx-sep { height: 1px; margin: 4px 6px; background: var(--border); }
</style>
