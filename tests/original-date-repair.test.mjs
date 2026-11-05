import test from 'node:test';
import assert from 'node:assert/strict';
import {originalDateRepair} from '../apps/desktop/original-date-repair.cjs';
import {testOperation,isWriteTestCommand} from '../apps/desktop/live-check.cjs';

function fixture() {
  const titles=['随行验证 · 最小读写验证','随行验证 · Windows 新增验证','随行验证 · Windows 同步验证'];
  const snapshot={pageId:'合成页',activeListId:'合成清单',activeListTitle:'随行验证（2026-11-04）',lists:[{title:'随行验证（2026-11-04）',id:'合成清单'}],items:titles.map((title,index)=>({title,id:'合成项'+index,listId:'合成清单',fingerprint:'合成指纹'+index,notes:'',completed:false,flagged:false,priority:'none',level:1,parentId:null}))};
  let clicks=0,outcome=null,empty=false,uncertain=false;const commands=[];
  return {commands,get clicks(){return clicks;},set uncertain(value){uncertain=value;},controller:{lastWriteOutcome:()=>outcome,execute:async command=>{
    commands.push(command.type);
    if(command.type==='readLists')return {ok:true,snapshot:{pageId:snapshot.pageId,lists:snapshot.lists}};
    if(command.type==='readList')return {ok:true,snapshot};
    if(command.type==='getSchedule')return {ok:true,snapshot,schedule:empty?{date:null,time:null,timeZone:null}:{date:'2030-01-15',time:'14:35',timeZone:'UTC'},editorTimeZone:'UTC',scheduleSource:'official-details'};
    assert.fail('不允许直接调用业务写入命令');
  }},options:{sendSnapshot(){},ui:{webContents:{executeJavaScript:async code=>{assert.match(code,/editTestSchedule/);clicks++;empty=true;outcome={type:'setSchedule',sequence:1,ok:!uncertain,code:uncertain?'UNCERTAIN_WRITE':'WEB_STATE_OBSERVED',replyPending:false};return true;}}}}};
}
test('历史清除命令退休且不读取账号，新修复与只读核对分别分类',async()=>{
  assert.equal((await testOperation({execute:()=>assert.fail('旧请求不能再读取或写入')},'clear-test-schedule',{})).code,'READ_ONLY');
  assert.equal(isWriteTestCommand('clear-test-schedule'),false);assert.equal(isWriteTestCommand('repair-original-test-date'),true);assert.equal(isWriteTestCommand('read-original-test-repair-state'),false);
  const state=fixture();assert.equal((await originalDateRepair(state.controller,'read-original-test-repair-state',state.options)).code,'ORIGINAL_DATE_PRESENT');assert.equal(state.clicks,0);assert.deepEqual(state.commands,['readLists','readList','getSchedule']);
});
test('新修复只点一次正式编辑入口，确认回执后指定读回，不直接调用保存 IPC',async()=>{
  const state=fixture(),result=await originalDateRepair(state.controller,'repair-original-test-date',state.options);
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.originalRepairState,'empty');assert.equal(result.cloudConfirmed,false);assert.equal(state.clicks,1);
  assert.deepEqual(state.commands,['readLists','readList','getSchedule','readList','getSchedule']);
});
test('正式回执不确定时不靠后续空日期升级成功，不进行第二次点击或读取',async()=>{
  const state=fixture();state.uncertain=true;
  assert.equal((await originalDateRepair(state.controller,'repair-original-test-date',state.options)).code,'UNCERTAIN_WRITE');assert.equal(state.clicks,1);assert.deepEqual(state.commands,['readLists','readList','getSchedule']);
});
test('原事项日期或备注已被外部改变时新修复停止，不覆盖后来的修改',async()=>{
  for(const field of ['schedule','notes']) {
    const state=fixture(),execute=state.controller.execute;
    state.controller.execute=async command=>{const result=await execute(command);if(field==='schedule' && command.type==='getSchedule')result.schedule={date:'2031-01-15',time:'14:35',timeZone:'UTC'};if(field==='notes' && command.type==='readList')result.snapshot.items[0].notes='合成外部修改';return result;};
    assert.equal((await originalDateRepair(state.controller,'repair-original-test-date',state.options)).ok,false);assert.equal(state.clicks,0);
  }
});
