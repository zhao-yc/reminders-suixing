import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutoUpdateScenario} from '../apps/desktop/auto-update-scenario.cjs';
import {isWriteTestCommand} from '../apps/desktop/live-check.cjs';
const LIST='随行验证（2026-11-04）',ITEM='随行验证 · Windows 自动更新验证';
const BASE=['随行验证 · 最小读写验证','随行验证 · Windows 新增验证','随行验证 · Windows 同步验证'];
function setup() {
  let target=false;const calls=[],base=BASE.map((title,index)=>({id:'synthetic-'+index,title,completed:false,fingerprint:'synthetic-fingerprint-'+index}));
  const receipt={sequence:1,ok:true,samePage:true,sameList:true,capturedAt:'old'};
  const client={ready:true,basePresent:true,targetPresent:false,unexpected:false,capturedAt:'new'};
  const controller={lastWriteOutcome:()=>null,lastAutomaticReadOutcome:()=>receipt,execute:async command=>{
    calls.push(command);assert.ok(['readLists','readList'].includes(command.type));
    if(command.type==='readLists')return {ok:true,snapshot:{pageId:'synthetic-page',lists:[{id:'synthetic-list',title:LIST}]}};
    assert.deepEqual(command,{type:'readList',pageId:'synthetic-page',listId:'synthetic-list'});
    return {ok:true,snapshot:{pageId:'synthetic-page',activeListId:'synthetic-list',activeListTitle:LIST,partial:false,items:[...base,...target?[{id:'synthetic-new',title:ITEM,completed:false,fingerprint:'new'}]:[]]}};
  }};
  const ui={isVisible:()=>true,isMinimized:()=>false,webContents:{executeJavaScript:async()=>({...client})}};
  const scenario=createAutoUpdateScenario(),run=command=>scenario.run(controller,ui,command,{sendSnapshot:()=>{},wait:async()=>{}});
  return {calls,controller,client,receipt,run,arrive:()=>{target=true;client.targetPresent=true;receipt.sequence++;receipt.capturedAt=client.capturedAt;}};
}

test('外部新增观察等待期间只读本地界面，不用主动官方读取帮助通过',async()=>{
  const s=setup();assert.equal((await s.run('begin-test-auto-observation')).code,'TEST_AUTO_OBSERVATION_READY');assert.equal(s.calls.length,2);
  for(let i=0;i<3;i++)assert.equal((await s.run('poll-test-auto-observation')).code,'TEST_AUTO_OBSERVATION_WAITING');assert.equal(s.calls.length,2);
  s.arrive();const result=await s.run('poll-test-auto-observation');assert.equal(result.code,'TEST_AUTO_EXTERNAL_CREATE_OBSERVED');assert.equal(result.noWrites,true);assert.equal(s.calls.length,3);
  assert.doesNotMatch(JSON.stringify(result),/synthetic|fingerprint/);assert.equal((await s.run('poll-test-auto-observation')).code,'TEST_AUTO_OBSERVATION_REQUIRED');
});

test('界面出现新项但没有同一次正式自动读取时间戳不能算通过',async()=>{
  const s=setup();await s.run('begin-test-auto-observation');s.arrive();s.receipt.capturedAt='different';
  assert.equal((await s.run('poll-test-auto-observation')).code,'TEST_AUTO_OBSERVATION_WAITING');assert.equal(s.calls.length,2);
});

test('观察中选区、过滤或未知记录变化立即停止，不读其他内容',async()=>{
  for(const patch of [{ready:false},{basePresent:false},{unexpected:true}]){const s=setup();await s.run('begin-test-auto-observation');Object.assign(s.client,patch);assert.equal((await s.run('poll-test-auto-observation')).code,'TEST_AUTO_OBSERVATION_INTERRUPTED');assert.equal(s.calls.length,2);}
});

test('只读观察不可覆盖未结束实例，结束操作不查询账户或派发写入',async()=>{
  const s=setup();assert.equal((await s.run('poll-test-auto-observation')).code,'TEST_AUTO_OBSERVATION_REQUIRED');await s.run('begin-test-auto-observation');assert.equal((await s.run('begin-test-auto-observation')).code,'TEST_AUTO_OBSERVATION_EXISTS');
  assert.equal((await s.run('end-test-auto-observation')).code,'TEST_AUTO_OBSERVATION_ENDED');assert.equal(s.calls.length,2);
  for(const c of ['begin-test-auto-observation','poll-test-auto-observation','end-test-auto-observation'])assert.equal(isWriteTestCommand(c),false);
});
