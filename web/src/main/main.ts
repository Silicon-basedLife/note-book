import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const target = document.getElementById('app');
if (!target) throw new Error('缺少 #app 挂载点');

const app = mount(App, { target });
export default app;
