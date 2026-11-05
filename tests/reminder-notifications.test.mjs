import test from 'node:test';
import assert from 'node:assert/strict';
import {createReminderNotifications,dueOccurrences} from '../apps/desktop/reminder-notifications.cjs';
const ready={region:'cn',pageId:'synthetic-page',listId:'synthetic-list',ready:true,busy:false,editing:false,readGeneration:1};
const item=(id,date='2026-11-05',time='12:00',timeZone='Asia/Shanghai')=>({id,completed:false,title:'随行验证 · 不进入通知正文',notes:'随行验证 · 合成备注',schedule:{date,time,timeZone}});
const result=items=>({ok:true,code:'READY',snapshot:{pageId:ready.pageId,activeListId:ready.listId,items}});
function setup(items=[item('one')],customRead) {
  let time=Date.parse('2026-11-05T03:59:30Z'),interval,cleared=false;
  const reads=[],shows=[],states=[];
  const service=createReminderNotifications({read:async(...args)=>{reads.push(args);return customRead?customRead(...args):result(items);},show:async count=>{shows.push(count);return {ok:true};},changed:s=>states.push(s),now:()=>time,localZone:()=> 'Asia/Shanghai',setInterval:(fn,ms)=>{assert.equal(ms,15000);interval=fn;return 1;},clearInterval:id=>{assert.equal(id,1);cleared=true;}});
  return {service,reads,shows,states,tick:()=>interval(),time:value=>time=Date.parse(value),enable:()=>service.configure({enabled:true,allDayTime:'09:00'}),cleared:()=>cleared};
}

test('通知默认关闭且没有清单就绪不读账户，启用不让旧到期内容大量补发',async()=>{
  const s=setup();await s.tick();assert.equal(s.reads.length,0);s.enable();await s.tick();assert.equal(s.reads.length,0);s.service.updateContext(ready);
  s.time('2026-11-05T04:00:02Z');await s.tick();assert.deepEqual(s.shows,[1]);
  assert.deepEqual(s.reads[0],[{type:'readList',pageId:ready.pageId,listId:ready.listId,background:true},'cn']);
  assert.doesNotMatch(JSON.stringify(s.states),/合成备注|不进入通知|synthetic-list|one/);
  const old=setup([item('past','2026-11-05','11:50')]);old.service.updateContext(ready);old.enable();await old.tick();assert.equal(old.shows.length,0);
  s.service.stop();assert.equal(s.cleared(),true);
});

test('多项同到期聚合一次，不把正文交给通知端；重复读取、时钟回拨和区域往返不重放',async()=>{
  const s=setup([item('a'),item('b')]);s.service.updateContext(ready);s.enable();s.time('2026-11-05T04:00:03Z');await s.tick();await s.tick();assert.deepEqual(s.shows,[2]);
  s.time('2026-11-05T03:59:50Z');await s.tick();s.time('2026-11-05T04:01:30Z');await s.tick();assert.deepEqual(s.shows,[2]);
  s.service.updateContext({...ready,region:'global'});await s.tick();s.service.updateContext(ready);await s.tick();assert.deepEqual(s.shows,[2,2]);s.service.stop();
});

test('休眠或编辑结束后先读当前状态，只补启用后仍未完成的到期项',async()=>{
  const rows=[item('due'),{...item('completed'),completed:true},item('future','2026-11-06')];const s=setup(rows);s.service.updateContext({...ready,editing:true});s.enable();s.time('2026-11-05T06:00:00Z');await s.tick();assert.equal(s.reads.length,0);
  s.service.updateContext(ready);await s.tick();assert.deepEqual(s.shows,[1]);s.service.stop();
});

test('后台读取未知、离线或选区错位后锁定，状态恢复不能代替明确手动核对',async()=>{
  for(const failure of [{ok:false,code:'OFFLINE'},{ok:false,code:'CONNECTION_UNAVAILABLE'},{ok:true,snapshot:{pageId:'other',activeListId:ready.listId,items:[]}}]) {
    let failed=true;const s=setup([],async()=>failed?failure:result([item('a')]));s.service.updateContext(ready);s.enable();s.time('2026-11-05T04:00:01Z');await s.tick();assert.equal(s.service.state().code,'READ_REQUIRED');
    failed=false;s.service.updateContext({...ready,busy:true});await s.tick();s.service.updateContext(ready);await s.tick();assert.equal(s.reads.length,1);assert.equal(s.shows.length,0);
    s.service.updateContext({...ready,readGeneration:2});await s.tick();assert.deepEqual(s.shows,[1]);s.service.stop();
  }
});

test('官方编辑或另一个命令占用仅暂缓，不错记故障或重复并发请求',async()=>{
  let resolve;const s=setup([],()=>new Promise(done=>resolve=done));s.service.updateContext(ready);s.enable();const first=s.tick();await s.tick();assert.equal(s.reads.length,1);resolve({ok:false,code:'AUTO_READ_DEFERRED'});await first;assert.equal(s.service.state().code,'');assert.equal(s.shows.length,0);s.service.stop();
});

test('旧区域、页面或编辑状态的迟到读取与销毁后的读取不发送通知',async()=>{
  for(const change of [s=>s.service.updateContext({...ready,region:'global'}),s=>s.service.updateContext({...ready,editing:true}),s=>s.service.configure({enabled:false,allDayTime:'09:00'}),s=>s.service.stop()]) {
    let resolve;const s=setup([],()=>new Promise(done=>resolve=done));s.service.updateContext(ready);s.enable();s.time('2026-11-05T04:00:00Z');const pending=s.tick();change(s);resolve(result([item('a')]));await pending;assert.equal(s.shows.length,0);s.service.stop();
  }
});

test('未知日期、错误日期/时区不猜测，明确无日期不计为未知',()=>{
  const out=dueOccurrences({items:[item('good'),item('bad-date','2026-02-30'),item('bad-zone','2026-11-05','12:00','Invalid/Zone'),{id:'unknown',completed:false},{id:'none',completed:false,schedule:{date:null,time:null,timeZone:null}}]},
    {now:Date.parse('2026-11-05T04:00:00Z'),from:Date.parse('2026-11-05T03:59:00Z'),allDayTime:'09:00',localZone:'Asia/Shanghai'});
  assert.equal(out.events.length,1);assert.equal(out.unknownDates,3);
});

test('全天按本地设置时间，指定时间按原时区，云端时间缺偏移时不猜测重复小时',async()=>{
  const all=dueOccurrences({items:[item('all','2026-11-05',null,null)]},{now:Date.parse('2026-11-05T01:00:00Z'),from:Date.parse('2026-11-05T00:59:00Z'),allDayTime:'09:00',localZone:'Asia/Shanghai'});assert.equal(all.events.length,1);
  const s=setup([item('fold','2026-11-01','01:30','America/New_York')]);s.time('2026-11-01T04:00:00Z');s.service.updateContext(ready);s.enable();s.time('2026-11-01T05:30:00Z');await s.tick();s.time('2026-11-01T06:30:00Z');await s.tick();assert.deepEqual(s.shows,[]);assert.equal(s.service.state().unknownDates,1);s.service.stop();
});

test('夏令时跳过的指定分钟不折算成另一个时刻，全天重复小时保持一次',()=>{
  const missing=dueOccurrences({items:[item('gap','2026-03-08','02:30','America/New_York')]},{now:Date.parse('2026-03-08T08:00:00Z'),from:Date.parse('2026-03-08T05:00:00Z'),allDayTime:'09:00',localZone:'UTC'});
  assert.equal(missing.events.length,0);assert.equal(missing.unknownDates,1);
  const local=dueOccurrences({items:[item('all','2026-11-01',null,null)]},{now:Date.parse('2026-11-01T05:30:00Z'),from:Date.parse('2026-11-01T04:00:00Z'),allDayTime:'01:30',localZone:'America/New_York'});assert.equal(local.events.length,1);
});

test('系统显示失败不自动重发，也不把随后只读成功抹成已显示',async()=>{
  let shown=0;let clock=Date.parse('2026-11-05T03:59:00Z');
  const s=createReminderNotifications({read:async()=>result([item('one')]),show:async()=>{shown++;return {ok:false};},now:()=>clock,localZone:()=> 'Asia/Shanghai',setInterval:()=>0,clearInterval:()=>{}});
  s.updateContext(ready);s.configure({enabled:true,allDayTime:'09:00'});clock=Date.parse('2026-11-05T04:00:00Z');await s.tick();await s.tick();assert.equal(shown,1);assert.equal(s.state().lastDeliveryUnconfirmed,true);s.stop();
});
