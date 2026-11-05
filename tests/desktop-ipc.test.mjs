import test from 'node:test';
import assert from 'node:assert/strict';
import {installDesktopIPC} from '../apps/desktop/ipc.cjs';

test('前台请求等待已经在执行的通知只读请求，随后只提交一次原命令',async()=>{
  const handlers=new Map(),frame={},contents={mainFrame:frame},calls=[];let release;
  const wait=new Promise(resolve=>release=resolve),command={type:'setCompleted',id:'synthetic'};
  const stop=installDesktopIPC({ipcMain:{handle:(k,v)=>handlers.set(k,v),removeHandler:k=>handlers.delete(k)},controller:{execute:c=>calls.push(c)},getMainWindow:()=>({webContents:contents}),notifications:{waitForRead:()=>wait}});
  const pending=handlers.get('suixing:execute')({sender:contents,senderFrame:frame},{region:'cn',command});await Promise.resolve();assert.equal(calls.length,0);release();await pending;assert.deepEqual(calls,[command]);stop();
});

test('原生窗口隐藏或最小化时自动读取不触及控制器，手动读取入口保持独立',async()=>{
  const handlers=new Map(),frame={},contents={mainFrame:frame},calls=[];
  let visible=true,minimized=false;
  const window={webContents:contents,isVisible:()=>visible,isMinimized:()=>minimized};
  const stop=installDesktopIPC({ipcMain:{handle:(k,v)=>handlers.set(k,v),removeHandler:k=>handlers.delete(k)},controller:{execute:c=>{calls.push(c);return {ok:true};}},getMainWindow:()=>window});
  const execute=handlers.get('suixing:execute'),event={sender:contents,senderFrame:frame},command={type:'readList',pageId:'synthetic-page',listId:'synthetic-list',background:true};
  visible=false;assert.equal((await execute(event,{region:'cn',command})).reason,'window-hidden');
  visible=true;minimized=true;assert.equal((await execute(event,{region:'cn',command})).code,'AUTO_READ_DEFERRED');assert.equal(calls.length,0);
  minimized=false;await execute(event,{region:'cn',command});assert.deepEqual(calls,[command]);
  visible=false;await execute(event,{region:'cn',command:{type:'read'}});assert.equal(calls.at(-1).type,'read');stop();
});

test('正式 IPC 仅接受本地主窗口主框架和固定区域，其他来源不触及控制器', async () => {
  const handlers=new Map();
  const ipcMain={handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)};
  const frame={};const contents={mainFrame:frame};const window={webContents:contents};const calls=[];
  const controller={execute:(...args)=>calls.push(['execute',...args]),openSite:(...args)=>calls.push(['openSite',...args]),reloadSite:(...args)=>calls.push(['reloadSite',...args]),reconnectSite:(...args)=>calls.push(['reconnectSite',...args]),connectionState:(...args)=>calls.push(['connectionState',...args])};
  const stop=installDesktopIPC({ipcMain,controller,getMainWindow:()=>window});
  for(const handler of handlers.values()) {
    for(const [event,args] of [
      [{sender:{},senderFrame:frame},{region:'cn'}],
      [{sender:contents,senderFrame:{}},{region:'cn'}],
      [{sender:contents,senderFrame:frame},{region:'https://example.invalid'}],
      [{sender:contents,senderFrame:frame},null]
    ])assert.equal((await handler(event,args)).code,'INVALID_REQUEST');
  }
  assert.equal(calls.length,0);
  const command={type:'createItem',pageId:'synthetic-page',listId:'synthetic-list',title:'随行验证 · 默认入口',requestId:'synthetic-request'};
  await handlers.get('suixing:execute')({sender:contents,senderFrame:frame},{region:'cn',command});
  assert.deepEqual(calls,[['execute',command,'cn']]);
  await handlers.get('suixing:reconnect-site')({sender:contents,senderFrame:frame},{region:'global'});
  assert.deepEqual(calls[1],['reconnectSite','global']);
  await handlers.get('suixing:connection-state')({sender:contents,senderFrame:frame},{region:'cn'});
  assert.deepEqual(calls[2],['connectionState','cn']);
  stop();assert.equal(handlers.size,0);
});
