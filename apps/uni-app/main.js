import { createSSRApp } from 'vue';
import App from './App.vue';

/** 使用 uni-app Vue3 入口，让 Android、鸿蒙和桌面 H5 共用页面。 */
export function createApp() {
  const app = createSSRApp(App);
  return { app };
}
