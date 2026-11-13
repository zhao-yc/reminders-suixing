// #ifdef APP-PLUS
import adapterSource from '../static/icloud/adapter.js?raw';
import { createAndroidBridge } from './android-bridge.js';
import { createProfileRuntime } from './android-profiles.js';
import { localRead, localWrite, localRemove, supportsProfiles, openProfile, profileAction, forgetProfile } from '@/uni_modules/suixing-local';
// #endif
// #ifdef APP-HARMONY
import harmonyAdapterSource from '../static/icloud/adapter.js?raw';
import { initializeICloudView } from '@/uni_modules/suixing-arkweb';
import { createHarmonyBridge } from './harmony-bridge.js';
import { localRead as harmonyRead, localWrite as harmonyWrite, localRemove as harmonyRemove, forgetHarmonySession } from '@/uni_modules/suixing-local';
// #endif

/** 普通浏览器只承担界面预览，明确拒绝把跨域 iframe 当成已连接的客户端。 */
function previewBridge(platform = '网页预览') {
  const unavailable = async () => ({ ok: false, code: 'CLIENT_REQUIRED', message: '请使用 Windows 或 Android 客户端连接 iCloud；网页预览仅展示界面。' });
  return { platform, execute: unavailable, openSite: unavailable, reloadSite: unavailable, dispose() {} };
}

/** 平台能力在此收口，页面不直接依赖 plus、Electron 或 ArkWeb 原生接口。 */
export function createBridge() {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.suixingDesktop) return window.suixingDesktop;
  // #endif
  // #ifdef APP-PLUS
  const profileRuntime=createProfileRuntime({openProfile,profileAction,forgetProfile});
  const defaultBridge=createAndroidBridge({runtime:plus,adapterSource,profileRuntime});
  const clients=new Map();
  function client(accountId) {
    if (!accountId || accountId.startsWith('legacy-')) return defaultBridge;
    if (!clients.has(accountId)) clients.set(accountId,createAndroidBridge({runtime:plus,adapterSource,profileRuntime}));
    return clients.get(accountId);
  }
  const accountMethods=Object.fromEntries(['execute','prepareSummary','readNavigation','readSummary','openSite','openLogin','reloadSite','reconnectSite','forgetAccount','connectionState'].map(method=>[
    method,(...args)=>{
      const accountId=args[method==='readSummary'?3:method==='execute'?2:1];
      return client(accountId)[method](...args);
    }
  ]));
  return {
    ...defaultBridge,
    ...accountMethods,
    hideSite:()=>Array.from(clients.values()).some(value=>value.hideSite()) || defaultBridge.hideSite(),
    dispose:()=>{for (const value of clients.values()) value.dispose(); defaultBridge.dispose();},
    localCapabilities: () => ({storage:true,multiple:supportsProfiles()}),
    localFiles:{read:localRead,write:localWrite,remove:localRemove}
  };
  // #endif
  // #ifdef APP-HARMONY
  initializeICloudView();
  return {
    ...createHarmonyBridge({ adapterSource: harmonyAdapterSource, summaryEnabled:true, forgetSession:forgetHarmonySession }),
    localCapabilities: () => ({storage:true,multiple:false}),
    localFiles:{read:harmonyRead,write:harmonyWrite,remove:harmonyRemove}
  };
  // #endif
  return previewBridge();
}
