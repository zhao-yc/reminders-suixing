const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createController } = require('./controller.cjs');
const { serveFrontend } = require('./frontend.cjs');
const { browserUserAgent } = require('./policy.cjs');

const ROOT = path.resolve(__dirname, '../..');
const smoke = process.argv.includes('--smoke-test');
const liveCheck = !app.isPackaged && process.argv.includes('--verify-live');
// 开发会话和验证数据留在已忽略目录；安装后的独立程序使用自身系统数据目录。
if (!app.isPackaged) app.setPath('userData', path.join(ROOT, '.local', smoke ? 'smoke-profile' : 'desktop-profile'));
app.setName('提醒事项·随行');
// 跨进程的登录 iframe 可能忽略 session.setUserAgent；创建窗口前统一回退标识，避免默认值含中文产品名。
app.userAgentFallback = browserUserAgent(process.versions.chrome);
let mainWindow;
let controller;
let stopLiveCheck;
const primary = smoke || app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => { mainWindow?.show(); controller?.openSite('cn'); });

/** 查找 HBuilderX 发布产物，不接受任意远程地址作为具有桌面权限的主界面。 */
function frontendPath() {
  for (const platform of ['web', 'h5']) {
    const file = path.join(ROOT, 'apps/uni-app/unpackage/dist/build', platform, 'index.html');
    if (fs.existsSync(file)) return file;
  }
  throw new Error('请先使用 HBuilderX CLI 执行 publish web，生成桌面界面。');
}

function installIPC() {
  for (const [channel, handler] of [
    ['suixing:execute', args => controller.execute(args.command, args.region)],
    ['suixing:open-site', args => controller.openSite(args.region)],
    ['suixing:reload-site', args => controller.reloadSite(args.region)]
  ]) {
    ipcMain.handle(channel, (event, args) => {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || !args || !['cn', 'global'].includes(args.region)) {
        return { ok: false, code: 'INVALID_REQUEST', message: '请求来源或区域无效。' };
      }
      return handler(args);
    });
  }
}

app.whenReady().then(async () => {
  if (!primary) return;
  const frontendURL = serveFrontend(frontendPath());
  if (smoke) {
    const { runSmoke } = require('./smoke.cjs');
    try { await runSmoke({ frontendURL, root: ROOT }); app.exit(0); }
    catch (error) { console.error('桌面合成验证失败：' + error.message); app.exit(1); }
    return;
  }
  controller = createController({ diagnostics: liveCheck });
  mainWindow = new BrowserWindow({
    width: 1160, height: 830, minWidth: 390, minHeight: 600, show: false,
    title: '提醒事项·随行', autoHideMenuBar: true, backgroundColor: '#f6f7f9',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  installIPC();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  await mainWindow.loadURL(frontendURL);
  mainWindow.show();
  console.log('已打开“提醒事项·随行”Windows 验证客户端。');
  if (liveCheck) {
    const { installLiveCheck } = require('./live-check.cjs');
    stopLiveCheck = installLiveCheck({ controller, ui: mainWindow, directory: path.join(ROOT, '.local'), sendSnapshot: result => mainWindow.webContents.send('suixing:snapshot', { region: 'cn', result }), quit: () => app.quit() });
    console.log('开发验证通道已就绪，命令信箱位于已忽略的 .local 目录。');
  }
  if (process.argv.includes('--open-icloud')) controller.openSite('cn');
  mainWindow.on('closed', () => app.quit());
}).catch(error => { console.error('启动失败：' + error.message); app.exit(1); });

app.on('window-all-closed', () => app.quit());
let quitting = false;
app.on('before-quit', event => {
  if (quitting || smoke) return;
  event.preventDefault();
  quitting = true;
  stopLiveCheck?.();
  // 等待内置存储完成正常写入后再销毁网页，不把登录状态另存为可导出的文件。
  Promise.resolve(controller?.flushStorage()).catch(() => console.warn('内置会话存储刷新未完成。')).finally(() => {
    controller?.dispose();
    app.quit();
  });
});
