import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLoadedItems } from '../apps/uni-app/lib/list-views.js';

const none={date:null,time:null,timeZone:null};
const item=(id,date=null,extra={})=>({id,title:id,notes:'',completed:false,level:1,flagged:false,schedule:date?{date,time:null,timeZone:null}:none,...extra});
const options={today:'2030-01-15',timeZone:'Asia/Shanghai'};
const ids=result=>result.items.map(item=>item.id);

test('今天包括今天与逾期，计划包括有日期的待办，不从附注或不可读字段猜测',()=>{
  const items=[item('逾期','2030-01-14'),item('今天','2030-01-15'),item('将来','2030-01-16'),item('无日期'),item('未知',null,{schedule:null,metadata:'今天'}),item('非法',null,{schedule:{date:'2030-02-30',time:null,timeZone:null}}),item('已完成','2030-01-15',{completed:true})];
  const today=projectLoadedItems(items,{...options,view:'today'});
  assert.deepEqual(ids(today),['逾期','今天']);
  assert.deepEqual(today.counts,{pending:6,today:2,scheduled:3,completed:1});
  assert.equal(today.unknownDates,2);assert.equal(today.unknownToday,2);
  assert.deepEqual(ids(projectLoadedItems(items,{...options,view:'scheduled'})),['逾期','今天','将来']);
});

test('筛选与排序使用原记录引用，不改事项；子事项匹配时保留祖先但不计入匹配数',()=>{
  const items=Object.freeze([Object.freeze(item('主事项')),Object.freeze(item('子事项','2030-01-15',{level:2})),Object.freeze(item('同级其他子项',null,{level:2})),Object.freeze(item('另一主项'))]);
  const result=projectLoadedItems(items,{...options,view:'today'});
  assert.deepEqual(ids(result),['主事项','子事项']);assert.deepEqual([...result.contextIds],['主事项']);
  assert.equal(result.matchCount,1);assert.equal(result.counts.today,1);assert.equal(result.items[0],items[0]);
  assert.equal(items.length,4);assert.deepEqual(items[0].schedule,none);
});

test('搜索与旗标可组合，祖先只供定位且不引入不匹配的兄弟或下一清单主项',()=>{
  const items=[item('前主项'),item('孙项父项',null,{level:2}),item('目标','2030-01-15',{level:3,flagged:true,notes:'找得到'}),item('兄弟','2030-01-15',{level:2}),item('后主项','2030-01-15',{flagged:true})];
  const result=projectLoadedItems(items,{...options,view:'scheduled',flagOnly:true,query:'找得到'});
  assert.deepEqual(ids(result),['前主项','孙项父项','目标']);assert.equal(result.matchCount,1);
  assert.deepEqual([...result.contextIds],['前主项','孙项父项']);assert.equal(result.flaggedCount,2);
});

test('已完成子事项可带未完成祖先作为只读上下文；缺主项的部分加载不虚构祖先',()=>{
  const items=[item('缺主项子项','2030-01-15',{level:2,completed:true}),item('主项'),item('完成子项',null,{level:2,completed:true})];
  const result=projectLoadedItems(items,{...options,view:'completed'});
  assert.deepEqual(ids(result),['缺主项子项','主项','完成子项']);assert.deepEqual([...result.contextIds],['主项']);assert.equal(result.matchCount,2);
});

test('跨午夜更新今天范围，闰年与无日期保持公历语义，不把无日期当作过期',()=>{
  const items=[item('闰日','2032-02-29'),item('三月','2032-03-01'),item('无日期')];
  assert.deepEqual(ids(projectLoadedItems(items,{...options,view:'today',today:'2032-02-28'})),[]);
  assert.deepEqual(ids(projectLoadedItems(items,{...options,view:'today',today:'2032-02-29'})),['闰日']);
  assert.deepEqual(ids(projectLoadedItems(items,{...options,view:'today',today:'2032-03-01'})),['闰日','三月']);
});

test('指定时间按读取时本机日历日归类，时区变化后只将旧指定时间标为今天不可确认',()=>{
  const timed=item('指定时间','2030-01-15',{schedule:{date:'2030-01-15',time:'23:55',timeZone:'Asia/Shanghai'}});
  const items=[timed,item('全天','2030-01-15')];
  assert.deepEqual(ids(projectLoadedItems(items,{...options,view:'today'})),['指定时间','全天']);
  const changed=projectLoadedItems(items,{...options,view:'today',timeZone:'America/New_York'});
  assert.deepEqual(ids(changed),['全天']);assert.equal(changed.unknownToday,1);assert.equal(changed.unknownDates,0);
  assert.equal(changed.counts.scheduled,2);
});

test('空列表与未知视图安全返回，完成项不受日期或旗标不可读计数影响',()=>{
  assert.equal(projectLoadedItems([],{...options,view:'today'}).matchCount,0);
  const result=projectLoadedItems([item('完成',null,{completed:true,schedule:null}),item('待办')],{...options,view:'合成未知'});
  assert.deepEqual(ids(result),['待办']);assert.equal(result.unknownDates,0);assert.equal(result.unknownToday,0);
});

test('不支持的时区既不计入今天，也不把格式合法但不可解释的时间当作已确认计划',()=>{
  const invalid=item('未知时区','2030-01-15',{schedule:{date:'2030-01-15',time:'12:00',timeZone:'Unknown/Zone'}});
  const result=projectLoadedItems([invalid],{...options,view:'scheduled'});
  assert.deepEqual(ids(result),[]);assert.equal(result.counts.scheduled,0);assert.equal(result.unknownDates,1);assert.equal(result.unknownToday,1);
});
