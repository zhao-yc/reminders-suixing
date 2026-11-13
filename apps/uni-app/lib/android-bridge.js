// #ifdef APP-PLUS
import { REGIONS, applePageHost, isApplePage } from './origins.js';
import { REPLY_PREFIX, MAX_PAYLOAD, isNativeWrite, normalizeCommand, parseNativeReply, nativeCommandScript } from './native-protocol.js';
import { collectSummary } from './collect-summary.mjs';

const failure = (code, message) => ({ ok: false, code, message });
const deferAutoRead = () => ({ ...failure('AUTO_READ_DEFERRED', '官方页面可见性尚未确认，自动更新暂缓。'), reason: 'window-hidden' });

/** Android 专用容器：远程网页无 5+ 权限，每个回执绑定到创建它的窗口与单次请求。 */
export function createAndroidBridge({ runtime, profileRuntime, adapterSource, timeoutMs = 18000, loginTimeoutMs = 600000, loginIntervalMs = 1000 }) {
  let webview = null;
  let activeRegion = '';
  let activeAccount;
  let ready = false;
  let needsRead = true;
  let disposed = false;
  let pending = null;
  let login = null;
  let summary = null;
  let hiding = null;
  let lastWriteAt = -Infinity;
  let counter = 0;

  function official(view) {
    try { return isApplePage(view.getURL()); } catch { return false; }
  }

  function isHidden(view) {
    try { return view.isVisible() === false; } catch { return false; }
  }

  function onRegionSite(view, region) {
    try {
      return applePageHost(view.getURL()) === applePageHost(REGIONS[region].url);
    } catch { return false; }
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
    if (result.ok && !current.write) ready = true;
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
        if (current.command.background && !current.loginProbe && !isHidden(view)) settle(current, deferAutoRead());
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
      if (event === 'close') {
        cancelLogin(view);
        webview = null;
      }
    });
    view.addEventListener('hide', () => {
      cancelLogin(view);
      if (hiding?.view === view) hiding.finish();
    });
  }

  function cancelLogin(view) {
    if (login?.view !== view) return;
    login.cancelled = true;
    login.wake?.();
    if (pending?.loginProbe) interrupt('LOGIN_CANCELLED', '已返回随行。');
  }

  function hideSite() {
    if (!webview || disposed || isHidden(webview)) return false;
    cancelLogin(webview);
    webview.hide('auto');
    return true;
  }

  function ensure(region, accountId) {
    if (webview && activeRegion === region && activeAccount === accountId) return webview;
    const previous = webview;
    webview = null;
    ready = false;
    needsRead = true;
    if (previous) previous.close('none');
    activeRegion = region;
    activeAccount = accountId;
    // 创建时传入已校验地区的固定入口。Android 的空白容器可能吞掉随后的首次导航。
    const container = accountId && !accountId.startsWith('legacy-') ? profileRuntime : runtime.webview;
    const viewOptions = {
      'uni-app': 'none', plusrequire: 'none', disablePlus: true,
      top: '0px', bottom: '0px', popGesture: 'hide',
      backButtonAutoControl: 'hide',
      titleNView: {
        titleText: 'iCloud 官方页面', titleColor: '#202735', backgroundColor: '#f6f7f9',
        buttons: [{ text: '返回应用', fontSize: '14px', width: '88px', onclick() {
          if (webview === view) hideSite();
        } }]
      }
    };
    const viewId = 'suixing-icloud-' + region;
    const view = container === runtime.webview ? container.create(REGIONS[region].url, viewId, viewOptions) :
      container.create(REGIONS[region].url, viewId, viewOptions, accountId);
    webview = view;
    try { configure(view); }
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
    if (login) return failure('BUSY', '请先完成官方页面登录或返回应用。');
    if (summary) return failure('BUSY', '正在读取清单汇总，请稍后再试。');
    if (pending && (changing || region !== activeRegion)) return failure('BUSY', '上一项操作尚未结束，请等待结果后再切换或重载。');
    return null;
  }

  /** 不重放写入；超时、导航或回执异常后，必须先成功读取当前页面。 */
  async function execute(input, region = 'cn', accountId) {
    const command = normalizeCommand(input, { scopedReads: true, itemWrites: true });
    if (!command) return failure('INVALID_COMMAND', '不支持或不完整的操作。');
    const blocked = unavailable(region, true);
    if (blocked) return blocked;
    if (command.background && (!webview || activeRegion !== region || activeAccount !== accountId)) return failure('PAGE_NOT_READY', '自动更新需要已打开的官方页面。');
    let view;
    try { view = ensure(region, accountId); } catch { return failure('BRIDGE_ERROR', '官方页面暂时无法打开，请稍后重试。'); }
    if (command.background && !isHidden(view)) return deferAutoRead();
    const navigationRead = command.type === 'read' || command.type === 'readLists';
    // 官方单页应用更新内容时不一定重发 loaded。只读操作可由适配器检查当前清单是否就绪。
    if (!official(view) || (!ready && (!navigationRead || !onRegionSite(view, region)))) {
      return failure('PAGE_NOT_READY', '官方提醒事项尚未就绪。请在官方页面看到清单后再刷新。');
    }
    const write = isNativeWrite(command.type);
    if (needsRead && (write || command.background || ['getSchedule', 'getDeleteInfo', 'showCompleted'].includes(command.type))) return failure('READ_REQUIRED', '请先刷新，核对当前页面后再操作。');
    if (write) lastWriteAt=Date.now();
    return dispatch(view, command, write);
  }

  function dispatch(view, command, write, loginProbe = false, commandTimeoutMs = timeoutMs) {
    return new Promise(resolve => {
      const id = Date.now().toString(36) + '-' + (++counter);
      const current = { id, view, resolve, write, command, loginProbe };
      pending = current;
      current.timer = setTimeout(() => {
        if (pending === current) interrupt('BRIDGE_TIMEOUT', '页面响应超时，请在官方页面核对后重新读取。');
      }, commandTimeoutMs);
      // 限制实际 URL 编码后的长度，避免中文正文使传输范围被低估。不拆分或重发命令。
      const source = nativeCommandScript(adapterSource, { ...command, androidCompact: true }, id);
      try { view.evalJS(source); }
      catch { interrupt('BRIDGE_ERROR', '页面命令未取得回执，请核对后重新读取。'); }
    });
  }

  /** 汇总期间独占官方窗口，读取范围和恢复选区交给两端共用的汇总逻辑。 */
  async function readSummary(pageId, listId, region = 'cn', accountId) {
    const blocked = unavailable(region, true);
    if (blocked) return blocked;
    if (typeof pageId !== 'string' || !pageId || pageId.length > 150 ||
        typeof listId !== 'string' || listId.length > 150) return failure('INVALID_COMMAND', '清单汇总参数无效。');
    const view = webview;
    const current = { cancelled: false };
    const canRead = () => !disposed && !current.cancelled && view && webview === view &&
      activeRegion === region && activeAccount === accountId && ready && isHidden(view) && onRegionSite(view, region);
    summary = current;
    const now = () => globalThis.performance?.now?.() ?? Date.now();
    try {
      if (hiding?.view === view) await hiding.done;
      const result = await collectSummary({ pageId, listId }, {
        canRead,
        // Android 隐藏 WebView 的计时器可能被降频，仍对每次读取和整个汇总设上限。
        timeoutMs: 60000,
        restoreTimeoutMs: 14000,
        read(request, deadline) {
          if (!canRead()) return deferAutoRead();
          const remaining = deadline - now();
          if (remaining <= 0) return failure('BRIDGE_TIMEOUT', '读取汇总超时，请稍后刷新。');
          return dispatch(view, request, false, false, Math.min(timeoutMs, remaining));
        }
      });
      if (!result.ok || !result.snapshot) needsRead = true;
      return result;
    } finally { summary = null; }
  }

  /** 登录交接只等清单导航就绪，并复用登录后的同一个官方窗口。 */
  async function openLogin(region = 'cn', accountId) {
    const blocked = unavailable(region, true);
    if (blocked) return blocked;
    let view;
    try { view = ensure(region, accountId); }
    catch { return failure('BRIDGE_ERROR', '官方页面暂时无法打开，请稍后重试。'); }
    const current = { view, cancelled: false, wake: null };
    login = current;
    const deadline = Date.now() + loginTimeoutMs;
    const active = () => !disposed && webview === view && !current.cancelled;
    const cancelled = () => failure('LOGIN_CANCELLED', '看到官方清单后，可返回随行并点击“刷新”。');
    try {
      view.show('slide-in-right', 180);
      while (active() && Date.now() < deadline) {
        if (onRegionSite(view, region)) {
          const result = await dispatch(view, { type: 'readLists', background: true }, false, true,
            Math.min(timeoutMs, 3000, Math.max(1, deadline - Date.now())));
          if (!active()) return cancelled();
          const snapshot = result.snapshot;
          if (onRegionSite(view, region) && !isHidden(view) && result.ok && result.needsListSelection &&
              snapshot?.pageId && snapshot.activeListId === null && snapshot.items.length === 0 &&
              (snapshot.lists.length > 0 || snapshot.emptyAccount === true)) {
            login = null;
            // 自动汇总等待窗口真正隐藏，避免和原生关闭动画竞争。
            let finish;
            const done = new Promise(resolve => { finish = resolve; });
            const timer = setTimeout(() => finish(), 1000);
            const handoff = { view, done, finish };
            hiding = handoff;
            done.then(() => {
              clearTimeout(timer);
              if (hiding === handoff) hiding = null;
            });
            try { view.hide('none'); }
            finally { if (isHidden(view)) finish(); }
            return { ...result, code: 'LOGIN_READY', initialSummary: true,
              message: snapshot.emptyAccount ? '已连接 iCloud，当前账号没有清单。' : '已连接 iCloud，请选择清单。' };
          }
        }
        if (!active()) return cancelled();
        await new Promise(resolve => {
          const timer = setTimeout(resolve, Math.min(loginIntervalMs, Math.max(0, deadline - Date.now())));
          current.wake = () => { clearTimeout(timer); resolve(); };
        });
        current.wake = null;
      }
      return active() ? failure('LOGIN_WAIT_TIMEOUT', '尚未读到官方清单。看到清单后，可返回随行并点击“刷新”。') : cancelled();
    } catch { return failure('BRIDGE_ERROR', '暂时无法确认官方页面状态，请返回应用后刷新。'); }
    finally { if (login === current) login = null; }
  }

  return {
    platform: 'Android', capabilities: { reconnect: true, editText: true, editFlag: true, editSchedule: true, deleteItem: true, openNewItem: true, createItem: true, showCompleted: true, loadedListRefresh: true }, execute, openLogin, hideSite, readSummary,
    connectionState() {
      const network = runtime.networkinfo;
      const type = network?.getCurrentType();
      if (!Number.isInteger(type)) return { ok: true, state: 'unknown' };
      if (type === network.CONNECTION_NONE) {
        if (summary) summary.cancelled = true;
        interrupt('OFFLINE', '网络已断开，联网后请重新读取。');
        return { ok: true, state: 'offline' };
      }
      // 仅判断设备已联网，仍需读取官方页面才能恢复写入。
      return { ok: true, state: type > network.CONNECTION_NONE ? 'available' : 'unknown' };
    },
    async prepareSummary(region, accountId) {
      const blocked = unavailable(region, true);
      if (blocked) return blocked;
      if (runtime.networkinfo?.getCurrentType()===runtime.networkinfo?.CONNECTION_NONE && runtime.networkinfo) return failure('OFFLINE','网络已断开。');
      if (Date.now()-lastWriteAt<30000) return deferAutoRead();
      if (webview && !isHidden(webview)) return failure('AUTO_READ_DEFERRED', '请先返回随行。');
      try {
        const existing = webview && activeRegion === region && activeAccount === accountId;
        const view = ensure(region, accountId);
        if (existing && ready) {
          const before=await dispatch(view,{type:'readLists',background:true,sessionProbe:true},false,false,3000);
          if (webview!==view || !isHidden(view)) return deferAutoRead();
          if (!before.ok && before.code!=='PAGE_NOT_READY') return before;
          ready=false;
          needsRead=true;
          view.reload();
        }
        return {ok:true};
      } catch { return failure('BRIDGE_ERROR', '官方页面暂时无法打开。'); }
    },
    async readNavigation(region, accountId) {
      if (!webview || activeRegion !== region || activeAccount !== accountId || !official(webview) || !isHidden(webview)) {
        return failure('PAGE_NOT_READY', '官方页面尚未就绪。');
      }
      const blocked = unavailable(region, true);
      return blocked || dispatch(webview, {type:'readLists', background:true, sessionProbe:true}, false, false, 3000);
    },
    async forgetAccount(region, accountId) {
      if (unavailable(region,true)) return failure('BUSY','请等待当前操作结束。');
      if (activeAccount === accountId && webview) {
        if (!isHidden(webview)) return failure('BUSY','请先返回随行。');
        webview.close('none');
        webview=null;
      }
      return {ok:await profileRuntime.forget(accountId)};
    },
    async openSite(region = 'cn', accountId) {
      const blocked = unavailable(region);
      if (blocked) return blocked;
      try { ensure(region, accountId).show('slide-in-right', 180); return { ok: true }; }
      catch { return failure('BRIDGE_ERROR', '官方页面暂时无法打开，请稍后重试。'); }
    },
    async reloadSite(region = 'cn', accountId) {
      const blocked = unavailable(region, true);
      if (blocked) return blocked;
      try {
        const existing = webview && activeRegion === region && activeAccount === accountId;
        const view = ensure(region, accountId);
        ready = false;
        needsRead = true;
        if (existing) view.reload();
        return { ok: true, message: '官方页面正在重新加载，请稍后读取。' };
      } catch { return failure('BRIDGE_ERROR', '官方页面暂时无法重新加载，请稍后重试。'); }
    },
    async reconnectSite(region = 'cn', accountId) {
      const blocked = unavailable(region, true);
      if (blocked) return blocked;
      try {
        if (webview && activeRegion === region && activeAccount === accountId) {
          ready = false;
          needsRead = true;
          webview.loadURL(REGIONS[region].url);
        } else ensure(region, accountId);
        return { ok: true };
      } catch { return failure('BRIDGE_ERROR', '官方页面暂时无法重新连接，请稍后重试。'); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ready = false;
      if (webview) cancelLogin(webview);
      interrupt('CLOSED', '连接已关闭。');
      const previous = webview;
      webview = null;
      if (previous) previous.close('none');
    }
  };
}
// #endif
