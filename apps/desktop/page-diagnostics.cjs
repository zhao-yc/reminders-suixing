/** 路由诊断只保留公开静态地址；服务接口仅保留主机，避免账户标识出现在路径日志中。 */
function diagnosticRoute(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return url.protocol;
    const publicPath = /^\/(?:applications|system|fonts|locales)\//.test(url.pathname) || ['/', '/reminders', '/reminders/'].includes(url.pathname);
    return url.origin + (publicPath ? url.pathname : '/<服务路径已省略>');
  } catch { return '无效地址'; }
}

/** 只读取公开结构与运行能力，不访问输入值、Cookie、认证请求或提醒事项正文。 */
async function inspectFrame(frame, timeout = 1500) {
  let timer;
  try {
    return await Promise.race([
      frame.executeJavaScript('({passwordField:!!document.querySelector("input[type=password]"),accountField:!!document.querySelector("input[type=email],input[autocomplete=username]"),connectionError:/There was a problem connecting to the server|连接服务器时出现问题|无法连接服务器/.test(document.body?.innerText||""),reminders:!!document.querySelector(".rm-list-menu-item"),runtime:{ua:navigator.userAgent,secure:isSecureContext,crypto:!!crypto.subtle,indexedDB:typeof indexedDB,worker:typeof Worker},scripts:[...document.scripts].filter(x=>x.src).map(x=>{const u=new URL(x.src);return u.origin+u.pathname})})'),
      new Promise(resolve => { timer = setTimeout(() => resolve('子页面诊断超时'), timeout); })
    ]);
  } catch { return '页面暂不可读取'; }
  finally { clearTimeout(timer); }
}

module.exports = { inspectFrame, diagnosticRoute };
