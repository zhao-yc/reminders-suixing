import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTestAutoRead} from '../apps/desktop/auto-read-verification.cjs';
import {isWriteTestCommand} from '../apps/desktop/live-check.cjs';
const title='随行验证（2026-11-04）';
const snapshot=()=>({pageId:'synthetic-page',activeListId:'synthetic-list',activeListTitle:title,capturedAt:'2026-11-05T00:00:00.000Z',partial:false,
  items:['最小读写验证','Windows 新增验证','Windows 同步验证'].map((value,index)=>({title:'随行验证 · '+value,completed:false,fingerprint:'synthetic-fingerprint-'+index}))});
function setup({changeFinal=false,updated=true,autoCode='READY',wrongScope=false}={}) {
  const calls=[];let readCount=0,automatic=null,focused=false,write=null;
  const controller={lastWriteOutcome:()=>write,lastAutomaticReadOutcome:()=>automatic,execute:async command=>{
    calls.push(command);if(command.type==='readLists')return {ok:true,snapshot:{pageId:'synthetic-page',lists:[{id:'synthetic-list',title}]}};
    assert.deepEqual(command,{type:'readList',pageId:'synthetic-page',listId:'synthetic-list'});const value=snapshot();
    if(wrongScope)value.items[0].title='合成非测试事项';if(changeFinal && readCount++)value.items[0].fingerprint='changed';return {ok:true,snapshot:value};
  }};
  const ui={isVisible:()=>true,isMinimized:()=>false,webContents:{executeJavaScript:async source=>{
    if(source==='window.dispatchEvent(new Event("focus"))'){focused=true;automatic={sequence:1,ok:autoCode==='READY',code:autoCode,samePage:true,sameList:true};return;}
    return {ready:true,updated:focused && updated};
  }}};
  const options={sendSnapshot:()=>{},wait:async()=>{},attempts:2};
  return {controller,ui,options,calls,setWrite:value=>write=value};
}

test('真实自动读取验收仅定向原三项，观察正式回执与界面时间后再核对，不派发业务写入',async()=>{
  const s=setup(),result=await verifyTestAutoRead(s.controller,s.ui,s.options);
  assert.equal(result.code,'TEST_AUTO_READ_OBSERVED');assert.equal(result.noWrites,true);assert.equal(result.clientUpdated,true);assert.equal(s.calls.length,3);
  assert.ok(s.calls.every(c=>['readLists','readList'].includes(c.type) && !c.background));assert.equal(isWriteTestCommand('verify-test-auto-read'),false);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-page|synthetic-list|fingerprint/);
});

test('非测试数据、隐藏窗口或已有写入记录在观察前停止',async()=>{
  const wrong=setup({wrongScope:true});assert.equal((await verifyTestAutoRead(wrong.controller,wrong.ui,wrong.options)).code,'TEST_SCOPE_REQUIRED');assert.equal(wrong.calls.length,2);
  const hidden=setup();hidden.ui.isVisible=()=>false;assert.equal((await verifyTestAutoRead(hidden.controller,hidden.ui,hidden.options)).code,'TEST_CLIENT_NOT_VISIBLE');assert.equal(hidden.calls.length,0);
  const written=setup();written.setWrite({sequence:1});assert.equal((await verifyTestAutoRead(written.controller,written.ui,written.options)).code,'TEST_READ_ONLY_SESSION_REQUIRED');assert.equal(written.calls.length,0);
});

test('后台读取成功但界面未采纳不能算通过，官方暂缓不被重读升级成功',async()=>{
  const stale=setup({updated:false});assert.equal((await verifyTestAutoRead(stale.controller,stale.ui,stale.options)).code,'TEST_AUTO_READ_NOT_OBSERVED');assert.equal(stale.calls.length,2);
  const deferred=setup({autoCode:'AUTO_READ_DEFERRED'});assert.equal((await verifyTestAutoRead(deferred.controller,deferred.ui,deferred.options)).code,'AUTO_READ_DEFERRED');assert.equal(deferred.calls.length,2);
});

test('验证中指纹变化必须停止，不将真实外部更改描述为字段保持',async()=>{
  const s=setup({changeFinal:true});assert.equal((await verifyTestAutoRead(s.controller,s.ui,s.options)).code,'TEST_AUTO_READ_CHANGED');
});
