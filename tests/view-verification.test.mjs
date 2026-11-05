import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTestViews } from '../apps/desktop/view-verification.cjs';
import { isWriteTestCommand,testOperation } from '../apps/desktop/live-check.cjs';

const before={pageId:'合成页',activeListId:'合成清单',activeListTitle:'随行验证（2026-11-04）',items:[0,1,2].map(index=>({id:'合成项'+index,title:'随行验证 · 合成'+index,completed:false,fingerprint:'合成指纹'+index,schedule:index===0?null:{date:null,time:null,timeZone:null}}))};
test('日期视图验收限定三条无可读已设日期的专用事项，无个人页面或写入命令',async()=>{
  let reads=0;
  const controller={lastWriteOutcome:()=>null,execute:async command=>{assert.deepEqual(command,{type:'readList',pageId:before.pageId,listId:before.activeListId});reads++;return {ok:true,snapshot:before};}};
  const ui={webContents:{executeJavaScript:async code=>{assert.match(code,/inspectTestViews/);assert.doesNotMatch(code,/setCompleted|setSchedule|setText|suixingDesktop/);return true;}}};
  assert.equal(isWriteTestCommand('verify-test-date-views'),false);
  assert.equal((await verifyTestViews(controller,ui,{...before,activeListTitle:'个人清单'})).code,'TEST_VIEWS_SCOPE_REQUIRED');assert.equal(reads,0);
  const dated={...before,items:before.items.map((item,index)=>index===1?{...item,schedule:{date:'2030-01-15',time:null,timeZone:null}}:item)};
  assert.equal((await verifyTestViews(controller,ui,dated)).code,'TEST_VIEWS_SCOPE_REQUIRED');assert.equal(reads,0);
  const result=await verifyTestViews(controller,ui,before);assert.equal(result.code,'TEST_VIEWS_OBSERVED');assert.equal(reads,1);assert.equal(result.viewTest.testItemsUnchanged,true);
});
test('日期视图验收不把界面未确认、外部变化或并发写入当作通过',async()=>{
  let sequence=0;
  const controller={lastWriteOutcome:()=>({sequence}),execute:async()=>({ok:true,snapshot:before})};
  assert.equal((await verifyTestViews(controller,{webContents:{executeJavaScript:async()=>false}},before)).ok,false);
  assert.equal((await verifyTestViews(controller,{webContents:{executeJavaScript:async()=>{sequence++;return true;}}},before)).ok,false);
  controller.execute=async()=>({ok:true,snapshot:{...before,items:[]}});
  assert.equal((await verifyTestViews(controller,{webContents:{executeJavaScript:async()=>true}},before)).ok,false);
});

test('日期视图命令先读导航再指定读取，选区变化或同名时绝不读取默认清单',async()=>{
  const commands=[];
  const controller={execute:async command=>{commands.push(command.type);if(command.type==='readLists')return {ok:true,snapshot:{pageId:before.pageId,lists:[{id:before.activeListId,title:before.activeListTitle}]}};assert.equal(command.type,'readList');assert.equal(command.listId,before.activeListId);return {ok:false,code:'STALE_VIEW'};}};
  const ui={webContents:{executeJavaScript:()=>assert.fail('选区不符不得观察界面事项')}};
  const options={ui,sendSnapshot:()=>assert.fail('不推送非指定快照')};
  assert.equal((await testOperation(controller,'verify-test-date-views',options)).code,'STALE_VIEW');assert.deepEqual(commands,['readLists','readList']);
  controller.execute=async command=>{assert.equal(command.type,'readLists');return {ok:true,snapshot:{pageId:before.pageId,lists:[{id:'合成一',title:before.activeListTitle},{id:'合成二',title:before.activeListTitle}]}};};
  assert.equal((await testOperation(controller,'verify-test-date-views',options)).code,'TEST_LIST_NOT_UNIQUE');
});
