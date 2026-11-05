const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const {validClock}=require('./reminder-notifications.cjs');

/** 运行正常窗口/IPC/托盘代码，只用新配置和固定测试通知，绝不打开 iCloud。 */
async function verifyNativeNotifications({app,window,notifications,controller,root}) {
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(check,label,timeout=8000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await pause(40);}assert.fail(label);}
  async function activate() {
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(process.execPath,[path.join(root,'apps/desktop/main.cjs'),'--verify-notifications'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
    const exited=new Promise((resolve,reject)=>{child.on('exit',code=>code===0?resolve():reject(Error('单实例辅助进程未正常退出')));child.on('error',reject);});
    await until(()=>window.isVisible() && !window.isMinimized(),'单实例激活未显示同一测试窗口');
    await exited;
  }
  const click=async selector=>assert.equal(await window.webContents.executeJavaScript('(()=>{const button=document.querySelector('+JSON.stringify(selector)+');if(!button || ["true",""].includes(button.getAttribute("disabled")))return false;button.click();return true;})()'),true,'测试控件不可用：'+selector);
  assert.equal(controller.window(),null,'原生合成验证不得创建官方页面');
  assert.equal(notifications.state().supported,true,'当前 Windows 通知 API 不可用');
  let savedOffTime;
  try {
    const stored=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'notification-preferences.json'),'utf8'));
    if(stored.enabled===false && validClock(stored.allDayTime))savedOffTime=stored.allDayTime;
  } catch {}
  if(savedOffTime) {
    assert.equal(notifications.state().enabled,false);
    assert.equal(notifications.state().allDayTime,savedOffTime);
    assert.equal(notifications.hideOnClose(),false);
  }
  if(notifications.state().enabled)assert.equal(notifications.configure({enabled:false,allDayTime:'09:00'}).ok,true);
  if(!window.isVisible() || window.isMinimized())await activate();
  await until(()=>window.webContents.executeJavaScript('!!document.querySelector(".notifications-settings-button")'),'通知设置入口未就绪');
  await click('.notifications-settings-button');
  await until(()=>window.webContents.executeJavaScript('!!document.querySelector(".notification-panel")'),'通知面板未显示');
  if(savedOffTime) {
    await until(()=>window.webContents.executeJavaScript('document.querySelector(".notification-time-picker")?.textContent.trim()==='+JSON.stringify(savedOffTime)),'窗口未恢复已保存的全天提醒时间');
    console.log('冷启动保留关闭状态和已保存的全天提醒时间，启动时未创建通知托盘。');
  }
  await click('.test-system-notification');
  await until(()=>window.webContents.executeJavaScript('document.querySelector(".notification-state")?.textContent.includes("系统已接收测试通知")'),'没有取得系统通知 show 回执');
  console.log('Windows 固定测试通知取得 show 事件；未检查通知中心或读取其他通知。');
  await click('.enable-system-notifications');
  await until(()=>notifications.state().enabled,'通知设置未启用');
  await until(()=>window.webContents.executeJavaScript('document.querySelector(".enable-system-notifications")?.textContent.includes("关闭通知") && !["true",""].includes(document.querySelector(".enable-system-notifications").getAttribute("disabled"))'),'通知设置界面未采纳启用结果');
  assert.equal(notifications.hideOnClose(),true);
  fs.writeFileSync(path.join(root,'.local/windows-notifications-desktop-20261105.png'),(await window.webContents.capturePage()).toPNG());
  window.setSize(391,800);await pause(150);
  await click('.close-notification-panel');await click('.mobile-menu');await click('.notifications-settings-button');
  await until(()=>window.webContents.executeJavaScript('!!document.querySelector(".notification-panel") && !document.querySelector(".sidebar.is-open")'),'窄屏入口没有关闭清单抽屉并显示设置');
  assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth<=window.innerWidth+2'),true,'窄屏通知设置横向溢出');
  fs.writeFileSync(path.join(root,'.local/windows-notifications-narrow-20261105.png'),(await window.webContents.capturePage()).toPNG());
  window.close();await until(()=>!window.isVisible(),'关闭窗口未隐藏到托盘');assert.equal(window.isDestroyed(),false);
  assert.equal(controller.window(),null,'开启托盘不能自行连接账户');
  await activate();
  await click('.enable-system-notifications');await until(()=>!notifications.state().enabled,'通知未关闭');assert.equal(notifications.hideOnClose(),false);
  assert.equal(window.isVisible(),true);assert.equal(controller.window(),null);
  console.log('真实托盘创建、关闭留在托盘、单实例恢复、关闭通知退出托盘及 391 宽度通过；全程无官方页面。');
}
module.exports={verifyNativeNotifications};
