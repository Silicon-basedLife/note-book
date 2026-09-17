import { mount } from 'svelte';
import Settings from './Settings.svelte';
import '../main/app.css';

const target = document.getElementById('settings-app');
if (!target) throw new Error('缺少 #settings-app 挂载点');

const app = mount(Settings, { target });
export default app;
