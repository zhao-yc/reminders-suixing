import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLoadedDateView, projectLoadedItems, projectAcrossLists } from '../apps/uni-app/lib/list-views.js';

const none={date:null,time:null,timeZone:null};
const item=(id,date=null,extra={})=>({id,title:id,notes:'',completed:false,level:1,flagged:false,schedule:date?{date,time:null,timeZone:null}:none,...extra});
const options={today:'2030-01-15',timeZone:'Asia/Shanghai'};
const ids=result=>result.items.map(item=>item.id);

test('跨清单今天合并日期组，重复记录标识和父子上下文仍分属来源清单',()=>{
  const lists=[
    {list:{id:'one',title:'合成清单一'},items:[item('重复标识','2030-01-14'),item('日期待核对',null,{schedule:null})]},
    {list:{id:'two',title:'合成清单二'},items:[item('第二清单主项'),item('重复标识','2030-01-15',{level:2}),item('已完成','2030-01-14',{completed:true})]}
  ];
  const result=projectAcrossLists(lists,{...options,view:'today'});
  assert.deepEqual(result.counts,{today:2,scheduled:2,pending:4,flagged:0,overdue:1,completed:1});
  assert.equal(result.unknown.today,1);
  assert.deepEqual(result.rows.map(entry=>[entry.list.id,entry.heading,entry.context]),[['one','逾期',false],['two','全天',true],['two','',false]]);
  assert.deepEqual(result.rows.map(entry=>entry.overdue),[true,false,false]);
  assert.equal(new Set(result.rows.map(entry=>entry.key)).size,3);
  assert.equal(projectAcrossLists(lists,{...options,view:'today',query:'找不到'}).matchCount,0);
});

test('跨清单计划按日期合并，旗标、待办和完成各用自己的条件，搜索不改卡片计数',()=>{
  const lists=[
    {list:{id:'one'},items:[item('未来','2030-02-01',{flagged:true}),item('明天甲','2030-01-16'),item('完成',null,{completed:true})]},
    {list:{id:'two'},items:[item('无日期'),item('今天','2030-01-15'),item('明天乙','2030-01-16')]}
  ];
  const scheduled=projectAcrossLists(lists,{...options,tomorrow:'2030-01-16',view:'scheduled'});
  assert.deepEqual(scheduled.rows.map(row=>[row.item.id,row.heading]),[['今天','今天'],['明天甲','明天'],['明天乙',''],['未来','2030-02-01']]);
  const pending=projectAcrossLists(lists,{...options,view:'pending',query:'无日期'});
  assert.equal(pending.matchCount,1);
  assert.equal(pending.counts.pending,5);
  assert.deepEqual(projectAcrossLists(lists,{...options,view:'flagged'}).rows.map(row=>row.item.id),['未来']);
  assert.deepEqual(projectAcrossLists(lists,{...options,view:'completed'}).rows.map(row=>row.item.id),['完成']);
});

test('今天包括今天与逾期，计划包括有日期的待办，不从附注或不可读字段猜测',()=>{
  const items=[item('逾期','2030-01-14'),item('今天','2030-01-15'),item('将来','2030-01-16'),item('无日期'),item('未知',null,{schedule:null,metadata:'今天'}),item('非法',null,{schedule:{date:'2030-02-30',time:null,timeZone:null}}),item('已完成','2030-01-15',{completed:true})];
  const today=projectLoadedItems(items,{...options,view:'today'});
  assert.deepEqual(ids(today),['逾期','今天']);
  assert.deepEqual(today.counts,{pending:6,today:2,scheduled:3,completed:1,overdue:1,flagged:0});
  assert.deepEqual([...today.overdueIds],['逾期']);
  assert.equal(today.unknownDates,2);assert.equal(today.unknownToday,2);
  assert.deepEqual(ids(projectLoadedItems(items,{...options,view:'scheduled'})),['逾期','今天','将来']);
  assert.deepEqual(ids(projectLoadedItems(items,{...options,view:'overdue'})),['逾期']);
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
  assert.equal(result.counts.flagged,2,'侧栏计数保持当前快照范围，不受搜索或日期视图影响');
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

test('今天按逾期、全天、上午、下午和今晚显示，日期不同的子事项仍留在原主项下',()=>{
  const timed=(id,time,extra={})=>item(id,null,{schedule:{date:options.today,time,timeZone:options.timeZone},...extra});
  const items=Object.freeze([
    timed('今晚','18:00'),item('全天',options.today),timed('下午','12:00'),
    item('只读主项'),timed('上午子项','11:59',{level:2}),timed('今晚子项','22:30',{level:2}),
    item('逾期','2030-01-14'),item('未知',null,{schedule:null})
  ]);
  const selection={...options,view:'today'};
  const projection=projectLoadedItems(items,selection);
  const display=groupLoadedDateView(projection,selection);
  assert.deepEqual(ids(display),['逾期','全天','只读主项','上午子项','今晚子项','下午','今晚']);
  assert.deepEqual([...display.headings],[['逾期','逾期'],['全天','全天'],['只读主项','上午'],['下午','下午'],['今晚','今晚']]);
  assert.deepEqual([...projection.contextIds],['只读主项']);
  assert.equal(projection.matchCount,6);
  assert.equal(display.items[2],items[3]);
});

test('计划按日期分组，日期倒序保留分组内顺序，旧时区指定时间单列',()=>{
  const tomorrow='2030-01-16';
  const items=[item('明天一',tomorrow),item('今天',options.today),item('明天二',tomorrow),
    item('旧时区',null,{schedule:{date:options.today,time:'23:55',timeZone:'America/New_York'}})];
  const selection={...options,tomorrow,view:'scheduled'};
  const projection=projectLoadedItems(items,selection);
  const forward=groupLoadedDateView(projection,selection);
  assert.deepEqual(ids(forward),['今天','明天一','明天二','旧时区']);
  assert.deepEqual([...forward.headings],[['今天','今天'],['明天一','明天'],['旧时区','时区待核对']]);
  assert.deepEqual(ids(groupLoadedDateView(projection,{...selection,descending:true})),['明天一','明天二','今天','旧时区']);
});
