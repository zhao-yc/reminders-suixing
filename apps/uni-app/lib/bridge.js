import adapterSource from '../static/icloud/adapter.js?raw';
import { REGIONS } from './origins.js';

/** 普通浏览器只承担界面预览，明确拒绝把跨域 iframe 当成已连接的客户端。 */
function previewBridge(platform = '网页预览') {
  const unavailable = async () => ({ ok: false, code: 'CLIENT_REQUIRED', message: '请使用 Windows 或 Android 客户端连接 iCloud；网页预览仅展示界面。' });
  return { platform, execute: unavailable, openSite: unavailable, reloadSite: unavailable, dispose() {} };
}

// #ifdef APP-PLUS
/** Android 的 5+ 网页容器不向远程站点开放原生权限，仅使用拦截的自定义 URL 返回固定命令结果。 */
function androidBridge() {
  let webview = null;
  let activeRegion = '';
  let ready = false;
  let pending = null;
  let counter = 0;

  function ensure(region) {
    if (!REGIONS[region]) throw new Error('不支持的服务区域。');
    if (webview && activeRegion === region) return;
    if (webview) webview.close('none');
    activeRegion = region;
    ready = false;
    webview = plus.webview.create('', 'suixing-icloud-' + region, {
      plusrequire: 'none', top: '0px', bottom: '0px', popGesture: 'hide',
      titleNView: {
        titleText: 'iCloud 官方页面', titleColor: '#202735', backgroundColor: '#f6f7f9',
        buttons: [{ text: '返回应用', fontSize: '14px', width: '88px', onclick() { webview.hide('auto'); } }]
      }
    });
    // 只允许官方站点留在容器内；其他跳转以及返回消息均被拦截，不交给系统处理。
    webview.overrideUrlLoading({
      mode: 'allow',
      match: '^https://([a-zA-Z0-9-]+\\.)*(icloud\\.com(\\.cn)?|apple\\.com(\\.cn)?)(/|$)',
      effect: 'instant'
    }, event => {
      const prefix = 'suixingbridge://reply?payload=';
      if (!event.url.startsWith(prefix) || !pending) return;
      try {
        const envelope = JSON.parse(decodeURIComponent(event.url.slice(prefix.length)));
        if (envelope.requestId !== pending.id) return;
        const current = pending;
        pending = null;
        clearTimeout(current.timer);
        current.resolve(envelope.result);
      } catch (_) { /* 非法或不完整消息不进入业务层，等待本次请求超时。 */ }
    });
    webview.addEventListener('loaded', () => { ready = true; });
    webview.addEventListener('loading', () => { ready = false; });
    webview.loadURL(REGIONS[region].url);
  }

  /** 每次只执行一个命令。超时返回不确定结果，不自动重放写操作。 */
  function execute(command, region = 'cn') {
    try { ensure(region); } catch (error) { return Promise.resolve({ ok: false, code: 'BRIDGE_ERROR', message: error.message }); }
    if (pending) return Promise.resolve({ ok: false, code: 'BUSY', message: '上一项操作尚未结束。' });
    if (!ready) return Promise.resolve({ ok: false, code: 'PAGE_NOT_READY', message: '请先打开官方页面，完成登录并等待页面载入。' });
    return new Promise(resolve => {
      const id = Date.now().toString(36) + '-' + (++counter);
      const timer = setTimeout(() => {
        if (!pending || pending.id !== id) return;
        pending = null;
        resolve({ ok: false, code: command.type === 'setCompleted' ? 'UNCERTAIN_WRITE' : 'BRIDGE_TIMEOUT', message: '页面响应超时，请在官方页面核对后重新读取。' });
      }, 18000);
      pending = { id, timer, resolve };
      const source = adapterSource + '\n' +
        '(function(){var id=' + JSON.stringify(id) + ';' +
        'window.__suixingAdapter.execute(' + JSON.stringify(command) + ').then(function(result){' +
        'var body=JSON.stringify({requestId:id,result:result});' +
        'if(body.length>110000)body=JSON.stringify({requestId:id,result:{ok:false,code:"PAYLOAD_TOO_LARGE",message:"当前列表超出验证版传输范围，请选择较小清单。"}});' +
        'location.href="suixingbridge://reply?payload="+encodeURIComponent(body);' +
        '});})();';
      webview.evalJS(source);
    });
  }

  return {
    platform: 'Android', execute,
    async openSite(region = 'cn') { ensure(region); webview.show('slide-in-right', 180); return { ok: true }; },
    async reloadSite(region = 'cn') { ensure(region); webview.reload(); return { ok: true, message: '官方页面正在重新加载，请稍后读取。' }; },
    dispose() { if (webview) webview.close('none'); if (pending) { clearTimeout(pending.timer); pending.resolve({ ok: false, code: 'CLOSED', message: '连接已关闭。' }); pending = null; } }
  };
}
// #endif

/** 平台能力在此收口，页面不直接依赖 plus、Electron 或未来的 ArkWeb 插件。 */
export function createBridge() {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.suixingDesktop) return window.suixingDesktop;
  // #endif
  // #ifdef APP-PLUS
  return androidBridge();
  // #endif
  // #ifdef APP-HARMONY
  return previewBridge('鸿蒙接入待验证');
  // #endif
  return previewBridge();
}
