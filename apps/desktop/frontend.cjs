const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { protocol, net } = require('electron');

// 使用独立安全源加载 HBuilderX 的绝对资源路径，保持 webSecurity 开启。
protocol.registerSchemesAsPrivileged([{ scheme: 'suixing', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

/** 只把固定发布目录映射到应用源，拒绝目录穿越和外部地址。 */
function serveFrontend(indexFile) {
  const root = path.resolve(path.dirname(indexFile));
  protocol.handle('suixing', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app' || request.method !== 'GET') return new Response('禁止访问', { status: 403 });
    let target;
    try { target = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); }
    catch { return new Response('路径无效', { status: 400 }); }
    if (!target.startsWith(root + path.sep)) return new Response('禁止访问', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
  return 'suixing://app/index.html';
}

module.exports = { serveFrontend };
