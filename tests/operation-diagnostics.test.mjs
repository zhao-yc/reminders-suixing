import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWriteOutcome, parseCreationStage, applyCreationStage } from '../apps/desktop/operation-diagnostics.cjs';

test('页面阶段回执只接受精确的固定标记，不提取其他日志中的内容', () => {
  assert.deepEqual(parseCreationStage('suixing-create-stage:3:writing-title'),{sequence:3,stage:'writing-title'});
  for(const message of ['其他日志 writing-title','suixing-create-stage:3:synthetic-private-title','suixing-create-stage:3:writing-title synthetic-private','suixing-create-stage:synthetic-private:writing-title','suixing-create-stage:9007199254740992:writing-title',null,{}]) assert.equal(parseCreationStage(message),null);
});

test('页面退出后的同次迟到阶段可留证，旧操作不能污染新操作且阶段不得回退', () => {
  const failed=summarizeWriteOutcome('createItem',3,{ok:false,code:'UNCERTAIN_WRITE'});
  const updated=applyCreationStage(failed,{sequence:3,stage:'writing-title'});
  assert.equal(updated.stage,'writing-title');assert.equal(updated.code,'UNCERTAIN_WRITE');assert.equal(updated.cloudConfirmed,false);
  assert.equal(applyCreationStage(updated,{sequence:3,stage:'waiting-draft'}),updated);
  const next=summarizeWriteOutcome('createItem',4,null,true);
  assert.equal(applyCreationStage(next,{sequence:3,stage:'observed'}),next);
});

test('写入回执诊断不访问事项、参数和异常正文，阶段只接受固定枚举', () => {
  const result={ok:true,code:'WEB_STATE_OBSERVED',stage:'observed',dispatched:true,cloudConfirmed:true};
  for(const key of ['snapshot','title','notes','id','message','token'])Object.defineProperty(result,key,{get(){assert.fail('不得读取业务或认证内容');}});
  assert.deepEqual(summarizeWriteOutcome('createItem',3,result),{type:'createItem',sequence:3,replyPending:false,code:'WEB_STATE_OBSERVED',stage:'observed',ok:true,dispatched:true,cloudConfirmed:false});
  const unknown=summarizeWriteOutcome('createItem',4,{code:'SYNTHETIC_PRIVATE',stage:'synthetic-private-title',message:'synthetic-private'});
  assert.equal(unknown.code,'OTHER');assert.equal(unknown.stage,'unknown');
  assert.doesNotMatch(JSON.stringify(unknown),/synthetic/i);
  const dateConflict=summarizeWriteOutcome('setSchedule',5,{ok:false,code:'SCHEDULE_UNAVAILABLE',dispatched:false,cloudConfirmed:false});
  assert.equal(dateConflict.code,'SCHEDULE_UNAVAILABLE');assert.equal(dateConflict.dispatched,false);assert.equal(dateConflict.ok,false);
});

test('挂起写入明确标记为进行中，不能当作已经保存；读取不生成写入回执', () => {
  const pending=summarizeWriteOutcome('createItem',1,null,true);
  assert.equal(pending.replyPending,true);assert.equal(pending.code,'IN_FLIGHT');assert.equal(pending.ok,false);assert.equal(pending.dispatched,null);
  assert.equal(summarizeWriteOutcome('read',1,{ok:true}),null);
  assert.equal(summarizeWriteOutcome('createItem',0,{}),null);
});

test('回执超时不表示没有派发，也不表示网页操作或云端保存已结束', () => {
  const unknown=summarizeWriteOutcome('createItem',2,{ok:false,code:'UNCERTAIN_WRITE'});
  assert.equal(unknown.replyPending,false);
  assert.equal(unknown.code,'UNCERTAIN_WRITE');
  assert.equal(unknown.dispatched,null);
  assert.equal(unknown.cloudConfirmed,false);
});
