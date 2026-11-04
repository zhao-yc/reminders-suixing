// #ifdef APP-PLUS
import adapterSource from '../static/icloud/adapter.js?raw';
import { createAndroidBridge } from './android-bridge.js';
// #endif

/** 普通浏览器只承担界面预览，明确拒绝把跨域 iframe 当成已连接的客户端。 */
function previewBridge(platform = '网页预览') {
  const unavailable = async () => ({ ok: false, code: 'CLIENT_REQUIRED', message: '请使用 Windows 或 Android 客户端连接 iCloud；网页预览仅展示界面。' });
  return { platform, execute: unavailable, openSite: unavailable, reloadSite: unavailable, dispose() {} };
}

/** 平台能力在此收口，页面不直接依赖 plus、Electron 或未来的 ArkWeb 插件。 */
export function createBridge() {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.suixingDesktop) return window.suixingDesktop;
  // #endif
  // #ifdef APP-PLUS
  return createAndroidBridge({ runtime: plus, adapterSource });
  // #endif
  // #ifdef APP-HARMONY
  return previewBridge('鸿蒙接入待验证');
  // #endif
  return previewBridge();
}
