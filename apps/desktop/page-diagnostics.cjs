/** 路由诊断只保留公开静态地址；服务接口仅保留主机，避免账户标识出现在路径日志中。 */
function diagnosticRoute(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return url.protocol;
    const publicPath = /^\/(?:applications|system|fonts|locales)\//.test(url.pathname) || ['/', '/reminders', '/reminders/'].includes(url.pathname);
    return url.origin + (publicPath ? url.pathname : '/<服务路径已省略>');
  } catch { return '无效地址'; }
}

/** 异常仅提取公开静态脚本的位置；不读取异常正文、远程对象、变量或调用参数。 */
function publicExceptionFrames(details) {
  return (details?.stackTrace?.callFrames || []).slice(0, 12).flatMap(frame => {
    try {
      const url = new URL(frame.url);
      if (!['www.icloud.com', 'www.icloud.com.cn'].includes(url.hostname) || !/^\/(?:applications|system)\/.+\.js$/.test(url.pathname) ||
          !Number.isInteger(frame.lineNumber) || !Number.isInteger(frame.columnNumber)) return [];
      return [{ source:url.origin+url.pathname, line:frame.lineNumber+1, column:frame.columnNumber+1 }];
    } catch { return []; }
  });
}

/** 仅开发验收启用 Chromium 异常位置事件；不订阅请求内容，不取远程对象或变量。 */
function tracePublicExceptions(debuggerAPI, record) {
  try {
    debuggerAPI.attach('1.3');
    debuggerAPI.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown') {
        const frames = publicExceptionFrames(params.exceptionDetails);
        if (frames.length) record('页面异常位置', {frames});
      } else if (method === 'Target.attachedToTarget' && params.sessionId) {
        debuggerAPI.sendCommand('Runtime.enable', {}, params.sessionId).catch(()=>{});
      }
    });
    debuggerAPI.sendCommand('Runtime.enable').catch(()=>{});
    debuggerAPI.sendCommand('Target.setAutoAttach', {autoAttach:true,waitForDebuggerOnStart:false,flatten:true}).catch(()=>{});
  } catch { record('异常位置诊断不可用', {}); }
}

/** 只读取公开结构与运行能力，不访问输入值、Cookie、认证请求或提醒事项正文。 */
async function inspectFrame(frame, timeout = 1500) {
  let timer;
  try {
    return await Promise.race([
      frame.executeJavaScript('({visibility:document.visibilityState,focused:document.hasFocus(),passwordField:!!document.querySelector("input[type=password]"),accountField:!!document.querySelector("input[type=email],input[autocomplete=username]"),connectionError:null,alertRegionPresent:!!document.querySelector("[role=alert], [role=alertdialog]"),reminders:!!document.querySelector(".rm-list-menu-item"),runtime:{ua:navigator.userAgent,secure:isSecureContext,crypto:!!crypto.subtle,indexedDB:typeof indexedDB,worker:typeof Worker},scripts:[...document.scripts].filter(x=>x.src).map(x=>{const u=new URL(x.src);return u.origin+u.pathname})})'),
      new Promise(resolve => { timer = setTimeout(() => resolve('子页面诊断超时'), timeout); })
    ]);
  } catch { return '页面暂不可读取'; }
  finally { clearTimeout(timer); }
}

module.exports = { inspectFrame, diagnosticRoute, publicExceptionFrames, tracePublicExceptions };
