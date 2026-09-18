import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { applyCachedTheme } from '../lib/desktop/theme.ts';

const target = document.getElementById('app');
if (!target) throw new Error('缺少 #app 挂载点');

// 挂载前先按设置快照定下主题，避免深色用户看到一闪而过的白底
applyCachedTheme();

const app = mount(App, { target });
export default app;
