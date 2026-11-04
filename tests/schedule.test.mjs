import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validSchedule,localDateString} from '../apps/uni-app/lib/schedule.js';
import {validCommand} from '../apps/desktop/policy.cjs';

const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');
const empty={date:null,time:null,timeZone:null};
const date={date:'2030-01-15',time:null,timeZone:null};

async function setup(t) {
  const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});
  t.after(()=>dom.window.close());dom.window.eval(source);
  const execute=command=>dom.window.__suixingAdapter.execute(command);
  const {snapshot}=await execute({type:'read'});
  return {window:dom.window,execute,snapshot,zone:dom.window.Intl.DateTimeFormat().resolvedOptions().timeZone};
}
function command(snapshot,type='getSchedule',index=0,extra={}) {
  const item=snapshot.items[index];
  return {type,pageId:snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed,expectedScheduleFingerprint:item.scheduleFingerprint,...extra};
}

test('日历日期、全天和带时区时间保持不同语义，非法闰日和越界时间不接受',()=>{
  for(const value of [empty,date,{date:'2028-02-29',time:'00:00',timeZone:'Asia/Shanghai'},{date:'0001-01-01',time:null,timeZone:null}]) assert.equal(validSchedule(value),true);
  for(const value of [{date:'2027-02-29',time:null,timeZone:null},{date:'1900-02-29',time:null,timeZone:null},{date:'2030-04-31',time:null,timeZone:null},{date:'0000-01-01',time:null,timeZone:null},{date:'2030-01-15',time:'24:00',timeZone:'UTC'},{date:'2030-01-15',time:'12:60',timeZone:'UTC'},{date:'2030-01-15',time:'12:00',timeZone:null},{date:null,time:'12:00',timeZone:'UTC'},{date:'2030-01-15',time:null,timeZone:'UTC'},{...date,extra:'synthetic'}]) assert.equal(validSchedule(value),false);
  assert.equal(localDateString(new Date(2026,10,4,23,59)),'2026-11-04');
});

test('读取日期只取当前行已加载字段，不打开详情、不从元数据猜日期、不存储',async t=>{
  const {window,execute,snapshot}=await setup(t);
  const result=await execute(command(snapshot,'getSchedule',1));
  assert.deepEqual(JSON.parse(JSON.stringify(result.schedule)),empty);
  assert.equal(window.fixtureScheduleSaves,0);assert.equal(window.fixtureScheduleCancels,0);
  assert.equal(window.document.querySelector('.details-popover'),null);
  assert.equal(window.fixtureClicks,0);
});

test('单个同名事项依次设置全天、指定时间和清除，每个目标仅存储一次',async t=>{
  const {window,execute,snapshot,zone}=await setup(t);
  let current=snapshot,expected=empty;
  for(const value of [date,{...date,time:'14:35',timeZone:zone},empty]) {
    const result=await execute(command(current,'setSchedule',1,{expectedSchedule:expected,value}));
    assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.cloudConfirmed,false);
    current=result.snapshot;
    const read=await execute(command(current,'getSchedule',1));
    assert.deepEqual(JSON.parse(JSON.stringify(read.schedule)),value);current=read.snapshot;expected=value;
  }
  assert.equal(window.fixtureScheduleSaveClicks,3);assert.equal(window.fixtureScheduleSaves,3);
  assert.deepEqual([...window.fixtureScheduleInputs],['date-year','date-month','date-day','time-hour','time-minute']);
  assert.equal(window.sessionStorage.getItem('fixture-schedule-'+snapshot.items[0].id),null);
  assert.equal(window.fixtureClicks,0);
});

test('日期输入支持跨年闰日和月份长度变化，不受旧日期截断影响',async t=>{
  const {window,execute,snapshot}=await setup(t);
  const leap={date:'2028-02-29',time:null,timeZone:null};
  const first=await execute(command(snapshot,'setSchedule',0,{expectedSchedule:empty,value:leap}));
  assert.equal(first.ok,true);
  const next={date:'2027-02-28',time:null,timeZone:null};
  const second=await execute(command(first.snapshot,'setSchedule',0,{expectedSchedule:leap,value:next}));
  assert.equal(second.ok,true);
  const read=await execute(command(second.snapshot));
  assert.deepEqual(JSON.parse(JSON.stringify(read.schedule)),next);
  assert.equal(window.fixtureScheduleSaves,2);
});

test('12小时制正确处理午夜、中午和晚间，不把上午下午当成任意文字',async t=>{
  const {window,execute,snapshot,zone}=await setup(t);window.fixtureScheduleUse12Hour=true;
  let current=snapshot,expected=empty;
  for(const time of ['00:05','12:30','23:59']) {
    const value={...date,time,timeZone:zone};
    const result=await execute(command(current,'setSchedule',0,{expectedSchedule:expected,value}));
    assert.equal(result.ok,true,time);current=result.snapshot;
    const read=await execute(command(current));
    assert.deepEqual(JSON.parse(JSON.stringify(read.schedule)),value);current=read.snapshot;expected=value;
  }
  assert.equal(window.fixtureScheduleSaves,3);
});

test('网页已经是目标日期时不再次存储',async t=>{
  const {window,execute,snapshot}=await setup(t);
  const result=await execute(command(snapshot,'setSchedule',0,{expectedSchedule:empty,value:empty}));
  assert.equal(result.code,'UNCHANGED');assert.equal(result.dispatched,false);
  assert.equal(window.fixtureScheduleSaves,0);assert.equal(window.fixtureScheduleSaveClicks,0);
  assert.equal(window.document.querySelector('.details-popover'),null);
});

test('未反映在行摘要中的日期冲突也拒绝覆盖',async t=>{
  const {window,execute,snapshot}=await setup(t);
  const record=window.document.getElementById(snapshot.items[0].id).__reactProps$fixture.children.props.item;
  record.DueDate=Date.UTC(2030,0,15);record.AllDay=true;record.TimeZone='UTC';
  const result=await execute(command(snapshot,'setSchedule',0,{expectedSchedule:empty,value:{date:'2031-01-15',time:null,timeZone:null}}));
  assert.equal(result.code,'STALE_VIEW');assert.equal(window.fixtureScheduleSaves,0);
  assert.equal(window.fixtureScheduleInputs.length,0);
});

test('日期文字不合法、旧页面或时区改变时不打开详情和存储',async t=>{
  const {window,execute,snapshot}=await setup(t);
  const base=command(snapshot,'setSchedule',0,{expectedSchedule:empty,value:date});
  assert.equal((await execute({...base,value:{...date,date:'2027-02-29'}})).code,'INVALID_COMMAND');
  assert.equal((await execute({...base,pageId:'synthetic-old-page'})).code,'STALE_VIEW');
  assert.equal((await execute({...base,value:{...date,time:'12:00',timeZone:'Synthetic/Other'}})).code,'STALE_VIEW');
  assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.fixtureScheduleCancels,0);
});

test('已有官方编辑窗口时不覆盖或取消它',async t=>{
  const {window,execute,snapshot}=await setup(t);
  window.document.querySelector('.info').click();
  assert.equal((await execute(command(snapshot))).ok,true);
  assert.ok(window.document.querySelector('.details-popover'));
  assert.equal(window.fixtureScheduleCancels,0);assert.equal(window.fixtureScheduleSaves,0);
});

test('官方分段输入未接受时取消自己的草稿，不换方式输入或发送存储',async t=>{
  const {window,execute,snapshot}=await setup(t);window.fixtureScheduleRejectInput=true;
  const change=command(snapshot,'setSchedule',0,{expectedSchedule:empty,value:date});
  const result=await execute(change);
  assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(window.fixtureScheduleInputs.length,1);
  assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.document.querySelector('.details-popover'),null);
  assert.equal((await execute(change)).code,'STALE_VIEW');
});

test('存储未关闭窗口时返回不确定，原命令不能产生第二次存储',async t=>{
  const {window,execute,snapshot}=await setup(t);window.fixtureScheduleDisableSave=true;
  const change=command(snapshot,'setSchedule',0,{expectedSchedule:empty,value:date});
  assert.equal((await execute(change)).code,'UNCERTAIN_WRITE');
  assert.equal(window.fixtureScheduleSaveClicks,1);assert.equal(window.fixtureScheduleSaves,0);
  const read=await execute({type:'read'});
  assert.equal((await execute(command(read.snapshot,'setSchedule',0,{expectedSchedule:empty,value:date}))).code,'EDIT_UNAVAILABLE');
  assert.equal(window.fixtureScheduleSaveClicks,1);
});

test('重复事项尚未验收时不改变日期或重复规则',async t=>{
  const {window,execute,snapshot}=await setup(t);
  window.document.querySelector('.info').addEventListener('click',()=>{const repeat=window.document.createElement('div');repeat.className='repeat-info';window.document.querySelector('.reminder-item-details').append(repeat);});
  assert.equal((await execute(command(snapshot,'setSchedule',0,{expectedSchedule:empty,value:date}))).code,'SCHEDULE_UNAVAILABLE');
  assert.equal(window.fixtureScheduleInputs.length,0);assert.equal(window.fixtureScheduleSaveClicks,0);
});

test('输入期间原事项变化时不提交草稿，也不补偿覆盖外部变更',async t=>{
  const {window,execute,snapshot}=await setup(t);
  window.document.addEventListener('beforeinput',()=>{window.document.getElementById(snapshot.items[0].id).querySelector('.title [role="textbox"]').textContent='随行验证 · 合成外部改名';},{once:true});
  const result=await execute(command(snapshot,'setSchedule',0,{expectedSchedule:empty,value:date}));
  assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(window.fixtureScheduleSaveClicks,0);
  assert.equal(window.document.getElementById(snapshot.items[0].id).querySelector('.title [role="textbox"]').textContent,'随行验证 · 合成外部改名');
});

test('日期 IPC 只接受固定字段和明确目标，不接收任意编辑动作',()=>{
  const target={pageId:'synthetic-page',listId:'synthetic-list',id:'synthetic-record',fingerprint:'synthetic-fingerprint',expectedCompleted:false,expectedScheduleFingerprint:'synthetic-date-fingerprint'};
  assert.equal(validCommand({type:'getSchedule',...target}),true);
  assert.equal(validCommand({type:'setSchedule',...target,expectedSchedule:empty,value:date}),true);
  assert.equal(validCommand({type:'setSchedule',...target,expectedSchedule:empty,value:{...date,time:'24:00',timeZone:'UTC'}}),false);
  assert.equal(validCommand({type:'setSchedule',...target,expectedSchedule:empty,value:{...date,script:'synthetic'}}),false);
});

test('已加载日期读取不遍历Fiber、根状态或其他记录字段，也不枚举记录',async t=>{
  const {window,execute}=await setup(t);const row=window.document.querySelector('.reminder-item');
  const allowed=new Set(['pk','DueDate','AllDay','TimeZone']);
  const target=row.__reactProps$fixture.children.props.item;
  const accessed=[];
  row.__reactProps$fixture.children.props.item=new Proxy(target,{get(record,key){assert.ok(allowed.has(key),'不得读取其他记录字段');accessed.push(key);return record[key];},ownKeys(){assert.fail('不得枚举整个记录');}});
  Object.defineProperty(row,'__reactFiber$fixture',{get(){assert.fail('不得读取Fiber');}});
  Object.defineProperty(row.__reactProps$fixture,'account',{get(){assert.fail('不得读取根状态');}});
  const read=await execute({type:'read'});const result=await execute(command(read.snapshot));
  assert.deepEqual(JSON.parse(JSON.stringify(result.schedule)),empty);
  assert.ok(accessed.includes('DueDate'));assert.equal(window.fixtureScheduleSaveClicks,0);
});

test('绑定结构未知或记录ID不匹配时日期明确不可用，不回退猜测',async t=>{
  const {window,execute}=await setup(t);const row=window.document.querySelector('.reminder-item');
  row.__reactProps$fixture.children.props.item.pk='synthetic-other-record';
  let read=await execute({type:'read'});assert.equal(read.ok,true);assert.equal(read.snapshot.items[0].schedule,null);
  assert.equal((await execute(command(read.snapshot))).code,'SCHEDULE_UNAVAILABLE');
  row.__reactProps$fixture.children=[];read=await execute({type:'read'});
  assert.equal((await execute(command(read.snapshot))).code,'SCHEDULE_UNAVAILABLE');
  assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.fixtureScheduleCancels,0);
});

test('日期字段为空但官方行仍有日期时不宣称已清除，也不打开编辑窗口',async t=>{
  const {window,execute}=await setup(t);const row=window.document.querySelector('.reminder-item');
  const record=row.__reactProps$fixture.children.props.item;
  row.querySelector('.metadata').innerHTML='<span class="due-date">2030/1/15 14:35</span>';
  for (const due of [null,undefined]) {
    record.DueDate=due;record.AllDay=false;record.TimeZone=undefined;
    const read=await execute({type:'read'});
    assert.equal(read.snapshot.items[0].schedule,null);
    assert.equal((await execute(command(read.snapshot))).code,'SCHEDULE_UNAVAILABLE');
    assert.equal((await execute(command(read.snapshot,'setSchedule',0,{expectedScheduleFingerprint:'synthetic-unavailable',expectedSchedule:empty,value:empty}))).code,'SCHEDULE_UNAVAILABLE');
  }
  assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.fixtureScheduleCancels,0);
  assert.equal(window.document.querySelector('.details-popover'),null);
});

test('清除后字段与官方日期显示不一致时返回未知，后续只读不能变成自动重放',async t=>{
  const {window,execute,snapshot,zone}=await setup(t);const id=snapshot.items[0].id;
  const timed={...date,time:'14:35',timeZone:zone};
  window.sessionStorage.setItem('fixture-schedule-'+id,JSON.stringify(timed));
  window.renderFixture('one');
  const before=await execute({type:'read'});
  // 模拟清除字段后仍显示旧日期的网页状态，不假设它已在服务器消失。
  window.document.addEventListener('click',event=>{
    if (!event.target.matches('button.primary')) return;
    const label=window.document.createElement('span');label.className='due-date';label.textContent='2030/1/15 14:35';
    window.document.getElementById(id).querySelector('.metadata').append(label);
  });
  const result=await execute(command(before.snapshot,'setSchedule',0,{expectedSchedule:timed,value:empty}));
  assert.equal(result.code,'UNCERTAIN_WRITE');assert.equal(result.cloudConfirmed,false);
  assert.equal(window.fixtureScheduleSaveClicks,1);
  const after=await execute({type:'read'});
  assert.equal(after.snapshot.items[0].schedule,null);
  assert.equal((await execute(command(after.snapshot))).code,'SCHEDULE_UNAVAILABLE');
  assert.equal((await execute(command(after.snapshot,'setSchedule',0,{expectedScheduleFingerprint:'synthetic-unavailable',expectedSchedule:empty,value:empty}))).code,'SCHEDULE_UNAVAILABLE');
  assert.equal(window.fixtureScheduleSaveClicks,1);
});

test('打开官方详情后日期与已读取字段不一致时取消草稿，不输入或存储',async t=>{
  const {window,execute,snapshot,zone}=await setup(t);const id=snapshot.items[0].id;
  // 列表快照仍为空，但官方详情已取得另外一个日期，模拟两个来源的冲突。
  window.sessionStorage.setItem('fixture-schedule-'+id,JSON.stringify({...date,time:'14:35',timeZone:zone}));
  const result=await execute(command(snapshot,'setSchedule',0,{expectedSchedule:empty,value:date}));
  assert.equal(result.code,'SCHEDULE_UNAVAILABLE');
  assert.equal(result.dispatched,false);assert.equal(result.cloudConfirmed,false);
  assert.equal(window.fixtureScheduleInputs.length,0);assert.equal(window.fixtureScheduleSaveClicks,0);
  assert.equal(window.fixtureScheduleCancels,1);assert.equal(window.document.querySelector('.details-popover'),null);
  assert.equal((await execute(command(snapshot,'setSchedule',0,{expectedSchedule:empty,value:date}))).code,'STALE_VIEW');
});

test('官方详情只存在已确认的全天 UTC 显示差异时，仍可单次改为指定时间',async t=>{
  const {window,execute,snapshot,zone}=await setup(t);const row=window.document.getElementById(snapshot.items[0].id);
  const record=row.__reactProps$fixture.children.props.item;
  record.DueDate=Date.UTC(2030,0,14,16);record.AllDay=true;record.TimeZone='Asia/Shanghai';
  row.querySelector('.metadata').innerHTML='<span class="due-date">2030/1/14</span>';
  window.sessionStorage.setItem('fixture-schedule-'+row.id,JSON.stringify({...date,date:'2030-01-14'}));
  const before=await execute({type:'read'});
  const timed={...date,time:'14:35',timeZone:zone};
  const result=await execute(command(before.snapshot,'setSchedule',0,{expectedSchedule:date,value:timed}));
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(window.fixtureScheduleSaveClicks,1);
  const after=await execute(command(result.snapshot));
  assert.deepEqual(JSON.parse(JSON.stringify(after.schedule)),timed);
});

test('全天详情出现其他日期时不能把任意差异当作时区修正',async t=>{
  const {window,execute,snapshot}=await setup(t);const row=window.document.getElementById(snapshot.items[0].id);
  const record=row.__reactProps$fixture.children.props.item;
  record.DueDate=Date.UTC(2030,0,14,16);record.AllDay=true;record.TimeZone='Asia/Shanghai';
  row.querySelector('.metadata').innerHTML='<span class="due-date">2030/1/14</span>';
  window.sessionStorage.setItem('fixture-schedule-'+row.id,JSON.stringify({...date,date:'2030-01-16'}));
  const before=await execute({type:'read'});
  const result=await execute(command(before.snapshot,'setSchedule',0,{expectedSchedule:date,value:empty}));
  assert.equal(result.code,'SCHEDULE_UNAVAILABLE');
  assert.equal(window.fixtureScheduleInputs.length,0);assert.equal(window.fixtureScheduleSaveClicks,0);
  assert.equal(window.fixtureScheduleCancels,1);
});

test('兼容官方旧版主机属性绑定，仍不读取内部实例或容器',async t=>{
  const {window,execute}=await setup(t);const row=window.document.querySelector('.reminder-item');
  Object.defineProperty(row,'__reactEventHandlers$fixture',{value:row.__reactProps$fixture,configurable:true});delete row.__reactProps$fixture;
  Object.defineProperty(row,'__reactInternalInstance$fixture',{get(){assert.fail('不得读取内部实例');}});
  Object.defineProperty(row,'__reactContainere$fixture',{get(){assert.fail('不得读取账户容器');}});
  const read=await execute({type:'read'});assert.equal((await execute(command(read.snapshot))).ok,true);
  Object.defineProperty(row,'__reactProps$duplicate',{value:row.__reactEventHandlers$fixture});
  const duplicate=await execute({type:'read'});assert.equal((await execute(command(duplicate.snapshot))).code,'SCHEDULE_UNAVAILABLE');
});

test('全天日期按已加载记录的时区恢复公历日期，不盲目给网页日期加一天',async t=>{
  const {window,execute}=await setup(t);const row=window.document.querySelector('.reminder-item');const record=row.__reactProps$fixture.children.props.item;
  for(const [due,zone,expected] of [[Date.UTC(2030,0,14,16),'Asia/Shanghai','2030-01-15'],[Date.UTC(2030,0,15),undefined,'2030-01-15'],[Date.UTC(2030,0,15,8),'America/Los_Angeles','2030-01-15'],[Date.UTC(2030,0,15,6),'America/Los_Angeles','2030-01-14']]) {
    record.DueDate=due;record.AllDay=true;record.TimeZone=zone;
    row.querySelector('.metadata').innerHTML='<span class="due-date"><span aria-hidden="false">'+new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'numeric',day:'numeric',timeZone:'UTC'}).format(new Date(due))+'</span></span>';
    const read=await execute({type:'read'});assert.equal(read.snapshot.items[0].schedule.date,expected);
    const result=await execute(command(read.snapshot));assert.equal(result.schedule.date,expected);
    assert.equal(result.schedule.time,null);assert.equal(result.schedule.timeZone,null);
  }
  assert.equal(window.fixtureScheduleSaveClicks,0);
});

test('全天显示保留可识别的重复附注，未知格式明确标记部分内容',async t=>{
  const {window,execute}=await setup(t);const row=window.document.querySelector('.reminder-item'),record=row.__reactProps$fixture.children.props.item;
  record.DueDate=Date.UTC(2030,0,14,16);record.AllDay=true;record.TimeZone='Asia/Shanghai';
  row.querySelector('.metadata').innerHTML='<span class="due-date"><span aria-hidden="false">2030/1/14，每月</span></span>';
  let read=await execute({type:'read'});assert.equal(read.snapshot.items[0].metadata,'2030/1/15，每月');assert.equal(read.snapshot.items[0].metadataPartial,false);
  row.querySelector('.due-date > span').textContent='合成未知日期格式，合成重复附注';
  read=await execute({type:'read'});assert.equal(read.snapshot.items[0].metadata,'2030-01-15');assert.equal(read.snapshot.items[0].metadataPartial,true);
});

test('行文字未变但已加载日期的秒数变化，也不能用旧指纹覆盖',async t=>{
  const {window,execute,zone}=await setup(t);const row=window.document.querySelector('.reminder-item'),record=row.__reactProps$fixture.children.props.item;
  record.DueDate=Date.UTC(2030,0,15,14,35);record.AllDay=false;record.TimeZone=zone;
  const read=await execute({type:'read'});const before=read.snapshot.items[0].schedule;
  record.DueDate+=1000;
  assert.equal((await execute(command(read.snapshot,'setSchedule',0,{expectedSchedule:before,value:empty}))).code,'STALE_VIEW');
  assert.equal(window.fixtureScheduleSaveClicks,0);
});
