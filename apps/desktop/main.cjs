const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { protectConsoleStreams } = require('./console-streams.cjs');
protectConsoleStreams();
const { createController } = require('./controller.cjs');
const { serveFrontend } = require('./frontend.cjs');
const { browserUserAgent } = require('./policy.cjs');
const { installDesktopIPC } = require('./ipc.cjs');
const {createNativeNotifications,bindNotificationClose}=require('./native-notifications.cjs');
const {APP_ID,APP_NAME}=require('./identity.cjs');

const ROOT = path.resolve(__dirname, '../..');
const smoke = process.argv.includes('--smoke-test');
const verifyNotifications=process.argv.includes('--verify-notifications');
if(verifyNotifications && app.isPackaged)throw Error('通知原生合成验证只允许独立开发配置。');
// 便携包也可显式启用同一受限验收通道；仍使用它自己的系统会话目录，不导入开发会话。
const liveCheck = process.argv.includes('--verify-live');
// 开发会话和验证数据留在已忽略目录；安装后的独立程序使用自身系统数据目录。
if (!app.isPackaged) app.setPath('userData', path.join(ROOT, '.local', verifyNotifications?'notification-native-profile':smoke ? 'smoke-profile' : 'desktop-profile'));
app.setName(APP_NAME);
if(process.platform==='win32')app.setAppUserModelId(APP_ID);
// 跨进程的登录 iframe 可能忽略 session.setUserAgent；创建窗口前统一回退标识，避免默认值含中文产品名。
app.userAgentFallback = browserUserAgent(process.versions.chrome);
let mainWindow;
let controller;
let stopLiveCheck;
let notifications;
let observeLiveNotification;
const primary = smoke || app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

/** 查找 HBuilderX 发布产物，不接受任意远程地址作为具有桌面权限的主界面。 */
function frontendPath() {
  for (const platform of ['web', 'h5']) {
    const file = path.join(ROOT, 'apps/uni-app/unpackage/dist/build', platform, 'index.html');
    if (fs.existsSync(file)) return file;
  }
  throw new Error('请先使用 HBuilderX CLI 执行 publish web，生成桌面界面。');
}

app.whenReady().then(async () => {
  if (!primary) return;
  const frontendURL = serveFrontend(frontendPath());
  if (smoke) {
    const { runSmoke } = require(process.argv.includes('--smoke-notifications')?'./smoke-notifications.cjs':process.argv.includes('--smoke-auto-read') ? './smoke-auto-read.cjs' : './smoke.cjs');
    try { await runSmoke({ frontendURL, root: ROOT }); app.exit(0); }
    catch (error) { console.error('桌面合成验证失败：' + error.message); app.exit(1); }
    return;
  }
  controller = createController({ diagnostics: liveCheck });
  mainWindow = new BrowserWindow({
    width: 1160, height: 830, minWidth: 390, minHeight: 600, show: false,
    title: '提醒事项·随行', autoHideMenuBar: true, backgroundColor: '#f6f7f9',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: !liveCheck }
  });
  notifications=createNativeNotifications({Notification,Tray,Menu,nativeImage,controller,window:mainWindow,
    settingsPath:path.join(app.getPath('userData'),'notification-preferences.json'),quit:()=>app.quit(),
    changed:state=>{
      if(!mainWindow.isDestroyed())mainWindow.webContents.send('suixing:notifications-state',state);
      observeLiveNotification?.(state);
    }});
  installDesktopIPC({ipcMain,controller,getMainWindow:()=>mainWindow,notifications});
  bindNotificationClose(mainWindow,notifications,()=>quitting);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  await mainWindow.loadURL(frontendURL);
  mainWindow.show();
  console.log('已打开“提醒事项·随行”Windows 验证客户端。');
  if (liveCheck) {
    const { installLiveCheck } = require('./live-check.cjs');
    const {createNotificationLiveCheck} = require('./notification-live-check.cjs');
    const sendSnapshot = result => mainWindow.webContents.send('suixing:snapshot', { region: 'cn', result });
    const notificationCheck = createNotificationLiveCheck({controller, ui:mainWindow, notifications, sendSnapshot});
    observeLiveNotification = notificationCheck.observe;
    stopLiveCheck = installLiveCheck({ controller, ui: mainWindow, directory: path.join(ROOT, '.local'), notificationCheck,
      environment:{packaged:app.isPackaged,profileKind:app.isPackaged?'system-default':'project-local',appVersion:app.getVersion()},
      sendSnapshot, quit: () => app.quit() });
    console.log('开发验证通道已就绪，命令信箱位于已忽略的 .local 目录。');
  }
  if (process.argv.includes('--open-icloud')) controller.openSite('cn');
  mainWindow.on('closed', () => app.quit());
  if(verifyNotifications) {
    try {await require('./verify-native-notifications.cjs').verifyNativeNotifications({app,window:mainWindow,notifications,controller,root:ROOT});console.log('原生通知合成验证通过；不代表真人可见或真实账号到期通知。');app.quit();}
    catch(error){console.error('原生通知合成验证失败：'+error.message);app.exit(1);}
  }
}).catch(error => { console.error('启动失败：' + error.message); app.exit(1); });

app.on('window-all-closed', () => app.quit());
let quitting = false;
app.on('before-quit', event => {
  if (quitting || smoke) return;
  event.preventDefault();
  quitting = true;
  stopLiveCheck?.();
  notifications?.dispose();
  // 等待内置存储完成正常写入后再销毁网页，不把登录状态另存为可导出的文件。
  Promise.resolve(controller?.flushStorage()).catch(() => console.warn('内置会话存储刷新未完成。')).finally(() => {
    controller?.dispose();
    app.quit();
  });
});
