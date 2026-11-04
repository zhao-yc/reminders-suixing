const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { BrowserWindow, ipcMain } = require('electron');
const { createController, allowedURL, validCommand } = require('./controller.cjs');
const { browserUserAgent } = require('./policy.cjs');
const { clickTestCompletion } = require('./verification-ui.cjs');

/** 真实 Electron + 合成网页，验证 iframe 读取、IPC、同名事项写回与重载后的状态保持。 */
async function runSmoke({ frontendURL, root }) {
  console.log('正在验证桌面网页桥接和构建界面…');
  const html = fs.readFileSync(path.join(root, 'tests/fixtures/reminders.html'), 'utf8');
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(request.url === '/agent' ? '<!doctype html><iframe src="http://localhost:' + server.address().port + '/frame"></iframe>' : request.url === '/frame' ? html : '<!doctype html><meta charset="utf-8"><iframe src="/frame"></iframe>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = createController({ fixtureURL: 'http://127.0.0.1:' + server.address().port + '/', diagnostics: true });
  let ui;
  let agentWindow;
  try {
    // localhost 与 127.0.0.1 是不同站点，验证登录所用的跨域 iframe 不会退回中文 Electron 标识。
    agentWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    await agentWindow.loadURL('http://127.0.0.1:' + server.address().port + '/agent');
    const agentFrames = agentWindow.webContents.mainFrame.framesInSubtree;
    assert.equal(agentFrames.length, 2);
    for (const frame of agentFrames) assert.equal(await frame.executeJavaScript('navigator.userAgent'), browserUserAgent(process.versions.chrome));
    console.log('跨站登录 iframe 的浏览器标识验证通过。');
    assert.equal(allowedURL('https://www.icloud.com.cn/reminders/'), true);
    assert.equal(allowedURL('https://icloud.com.evil.example/'), false);
    assert.equal(validCommand({ type: 'setCompleted', completed: 'true' }), false);
    controller.openSite('cn');
    controller.window().hide();
    let first;
    for (let attempt = 0; attempt < 30; attempt++) {
      first = await controller.execute({ type: 'read' }, 'cn');
      if (first.ok) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(first.ok, true, first.message);
    const diagnostics = await controller.diagnostics();
    assert.equal(diagnostics.opened, true);
    assert.equal(diagnostics.frames.length, 2);
    for (const frame of diagnostics.frames) assert.equal(frame.state.runtime.ua, browserUserAgent(process.versions.chrome));
    const item = first.snapshot.items[0];
    const update = await controller.execute({ type: 'setCompleted', pageId: first.snapshot.pageId,
      listId: item.listId, id: item.id, fingerprint: item.fingerprint, expectedCompleted: false, completed: true }, 'cn');
    assert.equal(update.code, 'WEB_STATE_OBSERVED');
    assert.equal(update.cloudConfirmed, false);
    await controller.window().webContents.executeJavaScript('location.reload()');
    let reloaded;
    for (let attempt = 0; attempt < 30; attempt++) {
      reloaded = await controller.execute({ type: 'read' }, 'cn');
      if (reloaded.ok && reloaded.snapshot.pageId !== first.snapshot.pageId) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(reloaded.snapshot.items[0].completed, true);
    assert.notEqual(reloaded.snapshot.pageId, first.snapshot.pageId);
    console.log('桌面网页桥接及重载验证通过。');

    ui = new BrowserWindow({ show: false, width: 1160, height: 830, webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false
    } });
    ui.webContents.on('console-message', event => { if (event.level === 'error') console.error('界面错误：' + event.message); });
    ipcMain.handle('suixing:execute', (event, args) => event.sender === ui.webContents ? controller.execute(args.command, args.region) : { ok: false });
    await ui.loadURL(frontendURL);
    await ui.webContents.executeJavaScript('new Promise((resolve,reject) => { const deadline=Date.now()+8000; const timer=setInterval(()=>{if(document.body.innerText.includes("连接我的提醒事项")){clearInterval(timer);resolve(true)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("构建界面未完成加载"))}},50) })');
    const uiState = await ui.webContents.executeJavaScript('({title:document.title, bridge:typeof window.suixingDesktop?.execute, hasNode:typeof require})');
    assert.equal(uiState.title, '提醒事项·随行');
    assert.equal(uiState.bridge, 'function');
    assert.equal(uiState.hasNode, 'undefined');
    const ipcRead = await ui.webContents.executeJavaScript('window.suixingDesktop.execute({type:"read"},"cn").then(r=>({ok:r.ok,count:r.snapshot?.items.length}))');
    assert.equal(ipcRead.ok, true);
    assert.equal(ipcRead.count, 2);
    // 使用真实构建出的 uni-button，验证完成与取消完成均走本地界面、受限 IPC 和共用适配器。
    for (const completed of [true, false]) {
      const current = await controller.execute({ type: 'read' }, 'cn');
      assert.equal(current.ok, true);
      const target = current.snapshot.items[0];
      assert.equal(target.completed, completed);
      ui.webContents.send('suixing:snapshot', { region: 'cn', result: current });
      const clicked = await ui.webContents.executeJavaScript('(' + clickTestCompletion.toString() + ')(' + JSON.stringify({
        pageId: current.snapshot.pageId, listId: target.listId, id: target.id, completed
      }) + ')', true);
      assert.equal(clicked, true, '构建界面的完成按钮必须可定位');
      let observed;
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        observed = await controller.execute({ type: 'read' }, 'cn');
        if (observed.snapshot?.items[0].completed === !completed) break;
      }
      assert.equal(observed.snapshot?.items[0].completed, !completed);
    }
    const writes = await controller.window().webContents.executeJavaScript('document.querySelector("iframe").contentWindow.fixtureClicks');
    assert.equal(writes, 2, '重载后的完成与取消完成各只写一次');
    console.log('构建界面完成与取消完成单次派发验证通过。');
    // 读写回归已进入清单页，重新加载本地界面后再从欢迎页进入明确标识的示例模式。
    await ui.loadURL(frontendURL);
    await ui.webContents.executeJavaScript('new Promise((resolve,reject)=>{const deadline=Date.now()+8000;const timer=setInterval(()=>{const b=document.querySelector(".demo-link");if(b){clearInterval(timer);b.click();resolve(true)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("示例入口未完成加载"))}},50)})');
    // 图形回归在真实窗口中刷新合成数据，避免隐藏窗口捕获到尺寸改变前的旧合成帧。
    ui.showInactive();
    await new Promise(resolve => setTimeout(resolve, 250));
    fs.writeFileSync(path.join(root, '.local/desktop-preview.png'), (await ui.webContents.capturePage()).toPNG());
    ui.setContentSize(390, 844);
    await ui.webContents.executeJavaScript('new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const timer=setInterval(()=>{const r=document.querySelector(".sidebar").getBoundingClientRect();if(r.right<=1){clearInterval(timer);requestAnimationFrame(()=>requestAnimationFrame(resolve))}else if(Date.now()>deadline){clearInterval(timer);reject(new Error("窄屏侧栏没有退出内容区域"))}},50)})');
    const layout = await ui.webContents.executeJavaScript('({width:innerWidth,media:matchMedia("(max-width:760px)").matches,sidebarPosition:getComputedStyle(document.querySelector(".sidebar")).position,sidebarRight:document.querySelector(".sidebar").getBoundingClientRect().right,scrollWidth:document.body.scrollWidth})');
    console.log('窄屏布局状态：' + JSON.stringify(layout));
    assert.equal(layout.media, true);
    assert.equal(layout.sidebarPosition, 'fixed');
    assert.ok(layout.sidebarRight <= 1);
    assert.ok(layout.scrollWidth <= layout.width + 1);
    const bounds = await ui.webContents.executeJavaScript('Object.fromEntries([".workspace",".notice",".list-content",".list-controls",".search",".reminder-row",".reminder-copy"].map(s=>{const n=document.querySelector(s);const r=n.getBoundingClientRect();return [s,{left:r.left,right:r.right,width:r.width,scroll:n.scrollWidth}]}))');
    console.log('窄屏内容范围：' + JSON.stringify(bounds));
    for (const [selector, rect] of Object.entries(bounds)) {
      assert.ok(rect.left >= -1 && rect.right <= layout.width + 1, selector + ' 不能超出窄屏内容区');
      assert.ok(rect.scroll <= Math.ceil(rect.width) + 1, selector + ' 不能横向裁切内容');
    }
    fs.writeFileSync(path.join(root, '.local/mobile-preview.png'), (await ui.webContents.capturePage()).toPNG());
    const report = {
      passed: true, kind: 'Electron 合成验证，不代表真实 iCloud 或真机验收',
      checks: ['跨站 iframe 浏览器标识', '只读子页面诊断', '同源 iframe 读取', '同名事项按记录 ID 操作', '完成状态重载保持', '旧页面句柄失效', '构建界面加载', '界面通过 IPC 读取', '构建界面完成及取消完成各派发一次', '页面无 Node 权限', '桌面与手机宽度布局'],
      capturedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.join(root, '.local'), { recursive: true });
    fs.writeFileSync(path.join(root, '.local/desktop-smoke.json'), JSON.stringify(report, null, 2));
    console.log('桌面合成验证通过：' + report.checks.join('、'));
  } finally {
    ipcMain.removeHandler('suixing:execute');
    ui?.destroy();
    agentWindow?.destroy();
    controller.dispose();
    await new Promise(resolve => server.close(resolve));
  }
}

module.exports = { runSmoke };
