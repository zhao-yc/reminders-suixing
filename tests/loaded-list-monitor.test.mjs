import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorLoadedList } from '../apps/uni-app/lib/loaded-list-monitor.js';

function setup(read = async command => ({ ok:true, snapshot:{pageId:command.pageId,activeListId:command.listId,items:[]} })) {
  let clock=10000,tick,cleared=false;
  const current={enabled:true,visible:true,live:true,demo:false,editing:false,recovery:false,busy:false,region:'cn',revision:0,snapshot:{pageId:'test-page',activeListId:'test-list',capturedAt:'1970-01-01T00:00:00.000Z'}};
  const calls=[],received=[],failed=[];let starts=0,finishes=0;
  const monitor=monitorLoadedList({state:()=>({...current}),read:async (...args)=>{calls.push(args);return read(...args);},started:()=>{starts++;current.busy=true;},finished:()=>{finishes++;current.busy=false;},received:r=>received.push(r),failed:r=>{failed.push(r);current.live=false;}},
    {now:()=>clock,setInterval:(fn,delay)=>{assert.equal(delay,20000);tick=fn;return 'timer';},clearInterval:id=>{assert.equal(id,'timer');cleared=true;}});
  return {current,calls,received,failed,monitor,tick:()=>tick(),advance:()=>clock+=4000,counts:()=>({starts,finishes}),cleared:()=>cleared};
}

test('自动更新只发同页同清单的只读命令，不在启动时读取账户',async()=>{
  const s=setup();assert.equal(s.calls.length,0);await s.tick();
  assert.deepEqual(s.calls,[[{type:'readList',pageId:'test-page',listId:'test-list',background:true},'cn']]);
  assert.equal(s.received.length,1);assert.deepEqual(s.counts(),{starts:1,finishes:1});s.monitor.stop();assert.equal(s.cleared(),true);
});

test('隐藏、编辑、忙碌、离线待核对、示例及未明确选择清单时不自动读取',async()=>{
  for(const patch of [{enabled:false},{visible:false},{live:false},{demo:true},{editing:true},{recovery:true},{busy:true},{region:'other'},{snapshot:null},{snapshot:{pageId:'page',activeListId:null}},{snapshot:{activeListId:'list'}}]) {
    const s=setup();Object.assign(s.current,patch);await s.tick();assert.equal(s.calls.length,0,JSON.stringify(patch));s.monitor.stop();
  }
});

test('焦点与周期相遇不重叠读取，短时间反复聚焦和刚手动读取均暂缓',async()=>{
  let done;const s=setup(()=>new Promise(resolve=>done=resolve));const first=s.tick();await s.tick();assert.equal(s.calls.length,1);
  done({ok:true,snapshot:{pageId:'test-page',activeListId:'test-list'}});await first;await s.tick();assert.equal(s.calls.length,1);
  s.advance();s.current.snapshot.capturedAt=new Date(14000).toISOString();await s.tick();assert.equal(s.calls.length,1);s.monitor.stop();
});

test('页面、清单、区域、网络版本或编辑状态变化后忽略迟到自动结果',async()=>{
  for(const mutate of [v=>v.region='global',v=>v.revision++,v=>v.snapshot={...v.snapshot,activeListId:'other'},v=>v.snapshot={...v.snapshot},v=>v.editing=true,v=>v.visible=false,v=>v.enabled=false,v=>v.recovery=true]) {
    let done;const s=setup(()=>new Promise(resolve=>done=resolve)),pending=s.tick();mutate(s.current);
    done({ok:true,snapshot:{pageId:'test-page',activeListId:'test-list'}});await pending;assert.equal(s.received.length,0);assert.equal(s.failed.length,0);assert.equal(s.current.busy,false);s.monitor.stop();
  }
});

test('自动结果选区错误时保留旧显示、停止自动读取，手动核对前不恢复',async()=>{
  for(const result of [{ok:true,snapshot:{pageId:'other',activeListId:'test-list'}},{ok:true,snapshot:{pageId:'test-page',activeListId:'other'}},{ok:true,needsListSelection:true,snapshot:{pageId:'test-page',activeListId:'test-list'}},{ok:false,code:'OFFLINE'},undefined]) {
    const s=setup(async()=>result),before=s.current.snapshot;await s.tick();assert.equal(s.failed.length,1);assert.equal(s.received.length,0);assert.equal(s.current.snapshot,before);s.advance();await s.tick();assert.equal(s.calls.length,1);s.monitor.stop();
  }
});

test('官方编辑或另一个命令占用时只暂缓，不解除保护或改写内容',async()=>{
  for(const code of ['AUTO_READ_DEFERRED','BUSY']) {const s=setup(async()=>({ok:false,code}));await s.tick();assert.equal(s.failed.length,0);assert.equal(s.received.length,0);assert.equal(s.current.live,true);s.monitor.stop();}
});

test('原生窗口隐藏兜底不消耗成功读取间隔，恢复可见后可立即核对',async()=>{
  let hidden=true;const s=setup(async command=>hidden?{ok:false,code:'AUTO_READ_DEFERRED',reason:'window-hidden'}:{ok:true,snapshot:{pageId:command.pageId,activeListId:command.listId}});
  await s.tick();hidden=false;await s.tick();assert.equal(s.calls.length,2);assert.equal(s.received.length,1);s.monitor.stop();
});

test('销毁后清理定时器并忽略成功、错误及抛异常的迟到回执',async()=>{
  for(const reject of [false,true]) {
    let done,fail;const s=setup(()=>new Promise((resolve,rejection)=>{done=resolve;fail=rejection;})),pending=s.tick();s.monitor.stop();
    if(reject)fail(Error('synthetic-private'));else done({ok:false,code:'OFFLINE'});await pending;await s.tick();assert.equal(s.failed.length,0);assert.equal(s.received.length,0);assert.equal(s.calls.length,1);assert.equal(s.cleared(),true);
  }
});

test('读取异常不泄漏底层内容，且不自动尝试重连或再次读取',async()=>{
  const s=setup(async()=>{throw Error('synthetic-private');});await s.tick();assert.equal(s.failed[0].code,'CONNECTION_FAILED');assert.doesNotMatch(JSON.stringify(s.failed),/synthetic-private/);s.advance();await s.tick();assert.equal(s.calls.length,1);s.monitor.stop();
});
