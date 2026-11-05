import test from 'node:test';
import assert from 'node:assert/strict';
import {installDesktopIPC} from '../apps/desktop/ipc.cjs';

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
