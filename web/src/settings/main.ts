import { mount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Settings from './Settings.svelte';
import '../main/app.css';
import { applyCachedTheme } from '../lib/desktop/theme.ts';

const target = document.getElementById('settings-app');
if (!target) throw new Error('缺少 #settings-app 挂载点');

// 挂载前先按设置快照定下主题，避免深色用户看到一闪而过的白底
applyCachedTheme();

const app = mount(Settings, { target });

// 桌面端：关闭设置窗口时改为“隐藏”，避免窗口被销毁后无法再次打开
if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
  const win = getCurrentWindow();
  void win.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await win.hide();
    } catch {
      /* ignore */
    }
  });
}

export default app;
