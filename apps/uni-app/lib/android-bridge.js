// #ifdef APP-PLUS
import { REGIONS, isApplePage } from './origins.js';
import { REPLY_PREFIX, MAX_PAYLOAD, isNativeWrite, normalizeCommand, parseNativeReply, nativeCommandScript } from './native-protocol.js';

const failure = (code, message) => ({ ok: false, code, message });
const deferAutoRead = () => ({ ...failure('AUTO_READ_DEFERRED', '官方页面可见性尚未确认，自动更新暂缓。'), reason: 'window-hidden' });

/** Android 专用容器：远程网页无 5+ 权限，每个回执绑定到创建它的窗口与单次请求。 */
export function createAndroidBridge({ runtime, adapterSource, timeoutMs = 18000 }) {
  let webview = null;
  let activeRegion = '';
  let ready = false;
  let needsRead = true;
  let disposed = false;
  let pending = null;
  let counter = 0;

  function official(view) {
    try { return isApplePage(view.getURL()); } catch { return false; }
  }

  function isHidden(view) {
    try { return view.isVisible() === false; } catch { return false; }
  }

  function settle(current, result) {
    if (pending !== current) return;
    pending = null;
    clearTimeout(current.timer);
    const { type, pageId, listId } = current.command;
    const scoped = current.write || ['readList', 'selectList', 'getSchedule', 'getDeleteInfo', 'showCompleted'].includes(type);
    if (result.ok && scoped &&
        (result.snapshot.pageId !== pageId || result.snapshot.activeListId !== listId)) {
      result = current.write
        ? { ...failure('UNCERTAIN_WRITE', '当前清单已变化，请在官方页面核对修改结果，不要重复提交。'), cloudConfirmed: false }
        : failure('STALE_VIEW', '当前清单已变化，请重新读取并选择清单。');
    }
    if (result.code !== 'AUTO_READ_DEFERRED') needsRead = !result.ok || type === 'readLists' || !result.snapshot?.activeListId;
    current.resolve(result);
  }

  function interrupt(code, message) {
    needsRead = true;
    if (!pending) return;
    const current = pending;
    settle(current, current.write
      ? { ...failure('UNCERTAIN_WRITE', '页面已中断，操作结果未知。请先在官方页面核对并重新读取，不要重复提交。'), cloudConfirmed: false }
      : failure(code, message));
  }

  function configure(view) {
    // 只放行官方 HTTPS 页面；返回通道和其他地址都被拦截，不交给系统应用。
    view.overrideUrlLoading({
      mode: 'allow', match: '^https://([a-zA-Z0-9-]+\\.)*(icloud\\.com(\\.cn)?|apple\\.com(\\.cn)?)(/|$)', effect: 'instant'
    }, event => {
      if (disposed || webview !== view || pending?.view !== view || !official(view)) return;
      if (typeof event.url !== 'string' || !event.url.startsWith(REPLY_PREFIX)) return;
      const current = pending;
      const payload = event.url.slice(REPLY_PREFIX.length);
      if (payload.length > MAX_PAYLOAD) { interrupt('INVALID_REPLY', '页面回执过大，请重新读取。'); return; }
      try {
        const result = parseNativeReply(payload, current.id);
        if (!result) return;
        if (current.command.background && !isHidden(view)) settle(current, deferAutoRead());
        else settle(current, current.write ? { ...result, cloudConfirmed: false } : result);
      } catch { interrupt('INVALID_REPLY', '页面回执不可读取，请重新读取。'); }
    });
    view.addEventListener('loaded', () => {
      if (!disposed && webview === view) ready = official(view);
    });
    for (const event of ['loading', 'error', 'close']) view.addEventListener(event, () => {
      if (disposed || webview !== view) return;
      ready = false;
      interrupt(event === 'close' ? 'CLOSED' : 'PAGE_CHANGED', '官方页面已变化，请等待载入后重新读取。');
      if (event === 'close') webview = null;
    });
  }

  function ensure(region) {
    if (webview && activeRegion === region) return webview;
    const previous = webview;
    webview = null;
    ready = false;
    needsRead = true;
    if (previous) previous.close('none');
    activeRegion = region;
    const view = runtime.webview.create('', 'suixing-icloud-' + region, {
      plusrequire: 'none', top: '0px', bottom: '0px', popGesture: 'hide',
      backButtonAutoControl: 'hide',
      titleNView: {
        titleText: 'iCloud 官方页面', titleColor: '#202735', backgroundColor: '#f6f7f9',
        buttons: [{ text: '返回应用', fontSize: '14px', width: '88px', onclick() {
          if (!disposed && webview === view) view.hide('auto');
        } }]
      }
    });
    webview = view;
    try { configure(view); view.loadURL(REGIONS[region].url); }
    catch {
      webview = null;
      view.close('none');
      throw new Error('无法载入官方页面');
    }
    return view;
  }

  function unavailable(region, changing = false) {
    if (disposed) return failure('CLOSED', '连接已关闭。');
    if (!Object.prototype.hasOwnProperty.call(REGIONS, region)) return failure('INVALID_REGION', '不支持的服务区域。');
    if (pending && (changing || region !== activeRegion)) return failure('BUSY', '上一项操作尚未结束，请等待结果后再切换或重载。');
    return null;
  }

  /** 不重放写入；超时、导航或回执异常后，必须先成功读取当前页面。 */
  async function execute(input, region = 'cn') {
    const command = normalizeCommand(input, { scopedReads: true, itemWrites: true });
    if (!command) return failure('INVALID_COMMAND', '不支持或不完整的操作。');
    const blocked = unavailable(region, true);
    if (blocked) return blocked;
    if (command.background && (!webview || activeRegion !== region)) return failure('PAGE_NOT_READY', '自动更新需要已打开的官方页面。');
    let view;
    try { view = ensure(region); } catch { return failure('BRIDGE_ERROR', '官方页面暂时无法打开，请稍后重试。'); }
    if (command.background && !isHidden(view)) return deferAutoRead();
    if (!ready || !official(view)) return failure('PAGE_NOT_READY', '请先打开官方页面，完成登录并等待页面载入。');
    const write = isNativeWrite(command.type);
    if (needsRead && (write || command.background || ['getSchedule', 'getDeleteInfo', 'showCompleted'].includes(command.type))) return failure('READ_REQUIRED', '请先刷新，核对当前页面后再操作。');
    return new Promise(resolve => {
      const id = Date.now().toString(36) + '-' + (++counter);
      const current = { id, view, resolve, write, command };
      pending = current;
      current.timer = setTimeout(() => {
        if (pending === current) interrupt('BRIDGE_TIMEOUT', '页面响应超时，请在官方页面核对后重新读取。');
      }, timeoutMs);
      // 限制实际 URL 编码后的长度，避免中文正文使传输范围被低估。不拆分或重发命令。
      const source = nativeCommandScript(adapterSource, command, id);
      try { view.evalJS(source); }
      catch { interrupt('BRIDGE_ERROR', '页面命令未取得回执，请核对后重新读取。'); }
    });
  }

  return {
    platform: 'Android', capabilities: { reconnect: true, editText: true, editFlag: true, editSchedule: true, deleteItem: true, openNewItem: true, createItem: true, showCompleted: true, loadedListRefresh: true }, execute,
    connectionState() {
      const network = runtime.networkinfo;
      const type = network?.getCurrentType();
      if (!Number.isInteger(type)) return { ok: true, state: 'unknown' };
      if (type === network.CONNECTION_NONE) {
        interrupt('OFFLINE', '网络已断开，联网后请重新读取。');
        return { ok: true, state: 'offline' };
      }
      // 仅判断设备已联网，仍需读取官方页面才能恢复写入。
      return { ok: true, state: type > network.CONNECTION_NONE ? 'available' : 'unknown' };
    },
    async openSite(region = 'cn') {
      const blocked = unavailable(region);
      if (blocked) return blocked;
      try { ensure(region).show('slide-in-right', 180); return { ok: true }; }
      catch { return failure('BRIDGE_ERROR', '官方页面暂时无法打开，请稍后重试。'); }
    },
    async reloadSite(region = 'cn') {
      const blocked = unavailable(region, true);
      if (blocked) return blocked;
      try {
        const existing = webview && activeRegion === region;
        const view = ensure(region);
        ready = false;
        needsRead = true;
        if (existing) view.reload();
        return { ok: true, message: '官方页面正在重新加载，请稍后读取。' };
      } catch { return failure('BRIDGE_ERROR', '官方页面暂时无法重新加载，请稍后重试。'); }
    },
    async reconnectSite(region = 'cn') {
      const blocked = unavailable(region, true);
      if (blocked) return blocked;
      try {
        if (webview && activeRegion === region) {
          ready = false;
          needsRead = true;
          webview.loadURL(REGIONS[region].url);
        } else ensure(region);
        return { ok: true };
      } catch { return failure('BRIDGE_ERROR', '官方页面暂时无法重新连接，请稍后重试。'); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ready = false;
      interrupt('CLOSED', '连接已关闭。');
      const previous = webview;
      webview = null;
      if (previous) previous.close('none');
    }
  };
}
// #endif
