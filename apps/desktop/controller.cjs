const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, session, net } = require('electron');
const { allowedURL, allowStorage, browserUserAgent, validCommand } = require('./policy.cjs');
const { inspectFrame, diagnosticRoute, tracePublicExceptions } = require('./page-diagnostics.cjs');
const { inspectTestEditor, inspectNewTestList } = require('./editor-diagnostics.cjs');
const { inspectTestDetails } = require('./date-diagnostics.cjs');
const { inspectTestListDelete } = require('./list-delete-diagnostics.cjs');
const { summarizeWriteOutcome, parseCreationStage, applyCreationStage } = require('./operation-diagnostics.cjs');
const { reopenOfficial } = require('./site-navigation.cjs');
const { readConnectionStatus,probePublicConnection } = require('./connection.cjs');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'apps/uni-app/static/icloud/adapter.js'), 'utf8');
const ENTRY = { cn: 'https://www.icloud.com.cn/reminders/', global: 'https://www.icloud.com/reminders/' };

/** 每个区域独立持久化会话。没有导入外部浏览器 Cookie，也没有账号密码读取接口。 */
function createController(options = {}) {
  let site = null;
  let activeRegion = '';
  let busy = false;
  let closing = false;
  let writeSequence = 0;
  let lastWriteOutcome = null;
  let automaticReadSequence=0,lastAutomaticReadOutcome=null;
  let lastReconnectOutcome = null;
  let reconnectSequence = 0;
  let connectionCache=null,connectionFailures=0,connectionSuspended=false;
  const trace = [];
  const fixtureURL = options.fixtureURL;
  const canNavigate = value => fixtureURL ? new URL(value).origin === new URL(fixtureURL).origin : allowedURL(value);

  /** 诊断仅保留公开路由和错误类型；不访问请求体、认证头、Cookie 或输入框的值。 */
  function route(value) {
    return diagnosticRoute(value);
  }

  function record(type, values) {
    if (!options.diagnostics) return;
    trace.push({ type, ...values });
    if (trace.length > 120) trace.shift();
  }

  function harden(contents) {
    contents.on('will-navigate', (event, url) => {
      if (!canNavigate(url)) { record('阻止主页面跳转', { route: route(url) }); event.preventDefault(); }
    });
    contents.on('will-frame-navigate', (event, details) => {
      const url = details?.url || event.url;
      if (url && !canNavigate(url)) { record('阻止子页面跳转', { route: route(url) }); event.preventDefault(); }
    });
    contents.on('console-message', event => {
      if (options.diagnostics && lastWriteOutcome?.type === 'createItem') {
        const receipt=parseCreationStage(event.message);
        if (receipt) {
          // 这里只接收本客户端创建的数字序号与固定阶段；不以此授予权限或确认云端保存。
          const updated=applyCreationStage(lastWriteOutcome,receipt);
          if (updated !== lastWriteOutcome) { lastWriteOutcome=updated; record('新增操作阶段',receipt); }
          return;
        }
      }
      if (event.level !== 'error') return;
      const issue = /SecurityError|TypeError|ReferenceError|SyntaxError|Content Security Policy|Failed to fetch|ERR_[A-Z_]+/.exec(event.message);
      const property = /Cannot read properties of (?:undefined|null) \(reading ['"]([a-zA-Z_$][a-zA-Z0-9_$]{0,40})['"]\)/.exec(event.message)?.[1];
      if (issue) record('页面脚本异常', { issue: issue[0], property, source: route(event.sourceId), category: issue[0] === 'Content Security Policy' ? event.message.replace(/'[^']*'|"[^"]*"/g, '<已省略>').slice(0, 500) : undefined, hosts: (event.message.match(/https?:\/\/[^\s"']+/g) || []).map(value => { try { return new URL(value).origin; } catch { return ''; } }) });
    });
    contents.setWindowOpenHandler(({ url }) => canNavigate(url) ? {
      action: 'allow', overrideBrowserWindowOptions: {
        parent: site, width: 920, height: 760,
        webPreferences: { partition: fixtureURL ? 'suixing-smoke' : 'persist:suixing-icloud-' + activeRegion, nodeIntegration: false, contextIsolation: true, sandbox: true }
      }
    } : { action: 'deny' });
    contents.on('did-create-window', popup => { harden(popup.webContents); });
  }

  function ensure(region = 'cn') {
    if (!Object.hasOwn(ENTRY, region)) throw new Error('不支持的服务区域。');
    if (site && !site.isDestroyed() && region === activeRegion) return site;
    if (site && !site.isDestroyed()) { closing = true; site.destroy(); closing = false; }
    activeRegion = region;
    connectionCache=null;connectionFailures=0;connectionSuspended=false;
    const partition = fixtureURL ? 'suixing-smoke' : 'persist:suixing-icloud-' + region;
    const isolated = session.fromPartition(partition);
    isolated.setUserAgent(browserUserAgent(process.versions.chrome), 'zh-CN,zh,en-US,en');
    isolated.setPermissionCheckHandler((contents, permission, origin, details = {}) => {
      const allowed = allowStorage(permission, details.requestingUrl || origin, details.embeddingOrigin || contents?.getURL() || '');
      record('权限检查', { permission, allowed, requester: route(details.requestingUrl || origin), embedding: route(details.embeddingOrigin || contents?.getURL() || '') });
      return allowed;
    });
    isolated.setPermissionRequestHandler((contents, permission, callback, details = {}) => {
      const allowed = allowStorage(permission, details.requestingUrl, contents?.getURL() || '');
      record('权限请求', { permission, allowed, requester: route(details.requestingUrl), embedding: route(contents?.getURL() || '') });
      callback(allowed);
    });
    // 诊断只记录主机名与错误码，绝不记录请求体、查询参数或认证请求头。
    if (!fixtureURL) {
      isolated.webRequest.onErrorOccurred(details => {
        record('网络失败', { route: route(details.url), error: details.error, resource: details.resourceType });
        if (allowedURL(details.url)) console.warn('官方页面网络错误：' + new URL(details.url).hostname + ' ' + details.error);
      });
      isolated.webRequest.onCompleted(details => {
        if (['xhr', 'subFrame', 'mainFrame'].includes(details.resourceType) || details.statusCode >= 400 || new URL(details.url).hostname === 'idmsa.apple.com') {
          record('网络响应', { route: route(details.url), status: details.statusCode, resource: details.resourceType });
        }
        if (allowedURL(details.url) && details.statusCode >= 400) console.warn('官方页面响应异常：' + new URL(details.url).hostname + ' HTTP ' + details.statusCode);
      });
    }
    isolated.on('will-download', event => event.preventDefault());
    site = new BrowserWindow({
      width: 1180, height: 830, minWidth: 700, minHeight: 600, show: false,
      title: 'iCloud 官方页面 · 提醒事项随行', autoHideMenuBar: true,
      // 官方自动保存需要在窗口隐藏后继续运行；仅关闭后台计时器节流，不放宽网页权限。
      webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false }
    });
    harden(site.webContents);
    if (options.diagnostics && !fixtureURL) tracePublicExceptions(site.webContents.debugger, record);
    site.webContents.setUserAgent(browserUserAgent(process.versions.chrome));
    site.on('close', event => { if (!closing) { event.preventDefault(); site.hide(); } });
    // 页面载入失败只反馈状态，不自动重新提交任何读写命令。
    site.loadURL(fixtureURL || ENTRY[region]).catch(() => {});
    return site;
  }

  async function connectionState(region='cn',force=false) {
    if(!['cn','global'].includes(region))return {ok:false,code:'INVALID_REQUEST'};
    const frames=site && !site.isDestroyed() && activeRegion===region?site.webContents.mainFrame.framesInSubtree:[];
    const target=frames.find(frame=>/\/applications\/reminders2\//.test(frame.url) && allowedURL(frame.url)) || frames[0];
    const frame=target && canNavigate(target.url)?target:null;
    const state=await readConnectionStatus(()=>net.isOnline(),frame,{probe:async()=>{
      if(!force && connectionCache?.region===region && Date.now()<connectionCache.expires)return connectionCache.reachable;
      const reachable=(await probePublicConnection(frame,new URL('/favicon.ico',fixtureURL || ENTRY[region]).href))===true;
      connectionFailures=reachable?0:Math.min(connectionFailures+1,5);
      connectionCache={region,reachable,expires:Date.now()+(reachable?15000:Math.min(30000,1000*2**connectionFailures))};
      return reachable;
    }});
    if(state.state==='offline')connectionCache=null;
    if(['offline','unavailable'].includes(state.state) && !connectionSuspended && frame) {
      connectionSuspended=true;
      try {await frame.executeJavaScript('window.__suixingAdapter?.invalidateConnection?.()');}catch{}
    } else if(state.state==='available')connectionSuspended=false;
    return state;
  }

  async function execute(command, region = 'cn') {
    if (!validCommand(command)) return { ok: false, code: 'INVALID_COMMAND', message: '不支持的操作参数。' };
    if (busy) return { ok: false, code: 'BUSY', message: '上一项操作尚未结束。' };
    busy = true;
    const automaticSequence=options.diagnostics && command.type==='readList' && command.background===true?++automaticReadSequence:0;
    if(automaticSequence)lastAutomaticReadOutcome={sequence:automaticSequence,ok:false,code:'IN_FLIGHT'};
    const write = ['setCompleted', 'setText', 'createItem', 'setSchedule', 'setFlagged', 'deleteItem', 'createList', 'renameList','deleteList','setListAppearance','setSubtask'].includes(command.type);
    const sequence = write && options.diagnostics ? ++writeSequence : 0;
    if (sequence) lastWriteOutcome = summarizeWriteOutcome(command.type, sequence, null, true);
    const finish = result => {
      if(automaticSequence)lastAutomaticReadOutcome={sequence:automaticSequence,ok:result?.ok===true,
        code:/^[A-Z_]{1,60}$/.test(result?.code || '')?result.code:'UNKNOWN',
        samePage:result?.snapshot?.pageId===command.pageId,sameList:result?.snapshot?.activeListId===command.listId,
        capturedAt:result?.ok && !Number.isNaN(Date.parse(result?.snapshot?.capturedAt))?result.snapshot.capturedAt:undefined};
      if (sequence) {
        const outcome=summarizeWriteOutcome(command.type,sequence,result);
        if (outcome.stage === 'unknown' && lastWriteOutcome?.sequence === sequence) outcome.stage=lastWriteOutcome.stage;
        lastWriteOutcome=outcome;
      }
      return result;
    };
    let timer;
    try {
      const network=await connectionState(region,write || ['read','readLists','readList','selectList'].includes(command.type));
      if(network.state==='offline' || network.state==='unavailable')return finish({ok:false,code:network.state==='offline'?'OFFLINE':'CONNECTION_UNAVAILABLE',message:'连接暂时不可用，保留上次读取内容；恢复后请刷新。',dispatched:false,cloudConfirmed:false});
      if(write && network.state!=='available')return finish({ok:false,code:'CONNECTION_UNAVAILABLE',message:'暂不能确认连接，请先读取核对。',dispatched:false,cloudConfirmed:false});
      if(network.state!=='available') {
        if(!site || site.isDestroyed() || activeRegion!==region)ensure(region);
        return finish({ok:false,code:'PAGE_NOT_READY',message:'官方页面或连接尚未就绪，请稍后重新读取。',dispatched:false,cloudConfirmed:false});
      }
      const window = ensure(region);
      const frames = window.webContents.mainFrame.framesInSubtree;
      const target = frames.find(frame => /\/applications\/reminders2\//.test(frame.url) && allowedURL(frame.url)) || window.webContents.mainFrame;
      if (!canNavigate(target.url)) return finish({ ok: false, code: 'PAGE_NOT_READY', message: '官方页面正在载入，请稍后读取。' });
      const phaseDiagnostics=options.diagnostics && command.type === 'createItem' ? '\nwindow.__suixingDiagnosticPhases=true;window.__suixingDiagnosticWriteSequence=' + sequence + ';' : '';
      const operation = target.executeJavaScript(SOURCE + phaseDiagnostics + '\nwindow.__suixingAdapter.execute(' + JSON.stringify(command) + ');', true);
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => resolve({ ok: false, code: write ? 'UNCERTAIN_WRITE' : 'BRIDGE_TIMEOUT', message: '页面响应超时，请打开官方页面核对。', cloudConfirmed: false }), 18000);
      });
      return finish(await Promise.race([operation, timeout]));
    } catch {
      return finish({ ok: false, code: write ? 'UNCERTAIN_WRITE' : 'PAGE_NOT_READY', message: '请在官方页面完成登录，等待清单显示后重新读取。', cloudConfirmed: false });
    } finally { clearTimeout(timer); busy = false; }
  }

  async function reconnectSite(region='cn') {
    if(!['cn','global'].includes(region)) return {ok:false,code:'INVALID_REQUEST',message:'服务区域无效。'};
    if(busy) return {ok:false,code:'BUSY',message:'请等待当前操作结束后再重新连接。'};
    busy=true;const sequence=++reconnectSequence;lastReconnectOutcome={sequence,ok:false,code:'IN_FLIGHT',attempts:[]};
    try {
      const network=await connectionState(region,true);
      const result=network.state!=='available'?{ok:false,code:network.state==='offline'?'OFFLINE':network.state==='unavailable'?'CONNECTION_UNAVAILABLE':'PAGE_NOT_READY',message:'连接尚未就绪，请稍后读取再重新连接。'}:await reopenOfficial(ensure(region).webContents,fixtureURL || ENTRY[region]);
      lastReconnectOutcome={sequence,ok:result.ok,code:result.code,attempts:result.attempts || []};return result;
    }
    finally {busy=false;}
  }

  return {
    execute,
    connectionState,
    adapterVersion() {return SOURCE.match(/version:\s*'(\d+\.\d+\.\d+)'/)?.[1] || 'unknown';},
    reconnectSite,
    lastWriteOutcome() { return lastWriteOutcome ? {...lastWriteOutcome} : null; },
    lastAutomaticReadOutcome() {return lastAutomaticReadOutcome?{...lastAutomaticReadOutcome}:null;},
    async inspectTestEditor() {
      if (!options.diagnostics) return { ok: false, code: 'DIAGNOSTICS_DISABLED' };
      if (!site || site.isDestroyed()) return { ok: false, code: 'PAGE_NOT_READY' };
      const frame = site.webContents.mainFrame.framesInSubtree.find(frame => /\/applications\/reminders2\//.test(frame.url) && allowedURL(frame.url));
      if (!frame) return { ok: false, code: 'PAGE_NOT_READY' };
      return inspectTestEditor(frame);
    },
    async inspectNewTestList() {
      if(!options.diagnostics) return {ok:false,code:'DIAGNOSTICS_DISABLED'};
      if(busy || !site || site.isDestroyed()) return {ok:false,code:'PAGE_NOT_READY'};
      const frame=site.webContents.mainFrame.framesInSubtree.find(frame=>/\/applications\/reminders2\//.test(frame.url) && allowedURL(frame.url));
      if(!frame) return {ok:false,code:'PAGE_NOT_READY'};
      busy=true;try {return await inspectNewTestList(frame);}finally{busy=false;}
    },
    async inspectTestListDelete() {
      if(!options.diagnostics) return {ok:false,code:'DIAGNOSTICS_DISABLED'};
      if(busy || !site || site.isDestroyed()) return {ok:false,code:'PAGE_NOT_READY'};
      const frame=site.webContents.mainFrame.framesInSubtree.find(frame=>/\/applications\/reminders2\//.test(frame.url) && allowedURL(frame.url));
      if(!frame)return {ok:false,code:'PAGE_NOT_READY'};
      busy=true;try{return await inspectTestListDelete(frame);}finally{busy=false;}
    },
    async inspectTestDetails(action) {
      if (!options.diagnostics) return {ok:false,code:'DIAGNOSTICS_DISABLED'};
      if (!site || site.isDestroyed()) return {ok:false,code:'PAGE_NOT_READY'};
      const frame=site.webContents.mainFrame.framesInSubtree.find(frame=>/\/applications\/reminders2\//.test(frame.url) && allowedURL(frame.url));
      if (!frame) return {ok:false,code:'PAGE_NOT_READY'};
      return inspectTestDetails(frame,action);
    },
    openSite(region = 'cn') {
      if (busy && region !== activeRegion) return { ok: false, code: 'BUSY', message: '请等待当前操作结束后再切换区域。' };
      ensure(region).show(); return { ok: true };
    },
    /** 仅受限验收：通过公开页面导航核对刷新，不调用网页内部同步服务。 */
    async inspectSiteConnection(action) {
      if (!options.diagnostics) return {ok:false,code:'DIAGNOSTICS_DISABLED'};
      if (!['show','hide','reopen'].includes(action)) return {ok:false,code:'INVALID_DIAGNOSTIC_ACTION'};
      if (busy) return {ok:false,code:'BUSY'};
      const window=ensure('cn');
      if (action==='show') {window.show();window.focus();return {ok:true,code:'SITE_SHOWN'};}
      if (action==='hide') {window.hide();return {ok:true,code:'SITE_HIDDEN'};}
      return reconnectSite('cn');
    },
    reloadSite(region = 'cn') {
      if (busy) return { ok: false, code: 'BUSY', message: '请等待当前操作结束后再重载。' };
      const contents = ensure(region).webContents;
      const destination = fixtureURL || ENTRY[region];
      let atEntry = false;
      try {
        const current = new URL(contents.getURL());
        const entry = new URL(destination);
        atEntry = current.origin === entry.origin && current.pathname.replace(/\/$/, '') === entry.pathname.replace(/\/$/, '');
      } catch { /* 未取得有效页面时重新打开固定官方入口。 */ }
      if (atEntry) contents.reload();
      else contents.loadURL(destination).catch(() => {});
      return { ok: true, message: '官方提醒事项正在重新加载，请稍后读取。' };
    },
    window() { return site; },
    /** 仅让 Chromium 将自己的待写入会话存储落盘，不读取、复制或更改 Cookie。是否长期登录由官方选项决定。 */
    async flushStorage() {
      if (!site || site.isDestroyed()) return;
      const storage = site.webContents.session;
      storage.flushStorageData();
      await storage.cookies.flushStore();
    },
    /** 开发诊断只允许点击官方页面的登录入口，不处理账号、密码或认证挑战。 */
    async openSignIn() {
      return ensure('cn').webContents.executeJavaScript('(()=>{const b=[...document.querySelectorAll("button,a,[role=button]")].find(x=>/^(Sign In|Sign in|登录|登入)$/.test(x.innerText.trim()));if(!b)return {clicked:false};for(const type of ["mousedown","mouseup","click"])b.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window}));return {clicked:true}})()', true);
    },
    /** 只检查公开页面结构及固定错误文案，诊断结果不包含账户或提醒事项内容。 */
    async diagnostics() {
      if (!site || site.isDestroyed()) return { opened: false, trace, lastWriteOutcome,lastReconnectOutcome };
      const frames = [];
      const available = site.webContents.mainFrame.framesInSubtree;
      for (const frame of available.slice(0, 12)) {
        const entry = { route: route(frame.url) };
        entry.state = await inspectFrame(frame);
        frames.push(entry);
      }
      return { opened: true, frames, framesTruncated: available.length > frames.length, trace, lastWriteOutcome,lastReconnectOutcome };
    },
    dispose() { closing = true; if (site && !site.isDestroyed()) site.destroy(); }
  };
}

module.exports = { createController, allowedURL, validCommand };
