import test from 'node:test';
import assert from 'node:assert/strict';
import { SORT_PREFERENCE_KEY, readSortPreference, saveSortPreference, sortLoadedItems } from '../apps/uni-app/lib/list-sort.js';

const empty = { date:null, time:null, timeZone:null };
const item = (id,date=null,time=null,level=1) => ({id,title:id,level,schedule:date?{date,time,timeZone:time?'Asia/Shanghai':null}:empty});
const ids = items => items.map(item => item.id);

test('清单顺序保持网页次序，返回新数组且排序不修改任何记录',()=>{
  const items=Object.freeze([Object.freeze(item('乙')),Object.freeze(item('甲'))]);
  assert.deepEqual(ids(sortLoadedItems(items,'manual')),['乙','甲']);
  assert.notEqual(sortLoadedItems(items,'manual'),items);
  assert.deepEqual(ids(sortLoadedItems(items,'title-ascending')),['甲','乙']);
  assert.deepEqual(ids(items),['乙','甲']);
  assert.equal(sortLoadedItems(items,'title-ascending')[0],items[1]);
});

test('日期排序使用结构化公历日期，全天在同日指定时间前，升降序均将无日期放后',()=>{
  const items=[item('无日期'),item('晚间','2030-01-15','20:00'),item('次日','2030-01-16'),item('全天','2030-01-15'),item('上午','2030-01-15','09:00')];
  assert.deepEqual(ids(sortLoadedItems(items,'date-ascending')),['全天','上午','晚间','次日','无日期']);
  assert.deepEqual(ids(sortLoadedItems(items,'date-descending')),['次日','全天','晚间','上午','无日期']);
});

test('日期不可读与明确无日期不同，未知或非法日期不从文案猜测且保留末尾原顺序',()=>{
  const unknown={...item('不可读'),schedule:null,metadata:'今天 09:00'};
  const invalid={...item('非法日期'),schedule:{date:'2030-02-30',time:null,timeZone:null}};
  const items=[unknown,item('无日期'),invalid,item('有效','2030-01-15')];
  for(const mode of ['date-ascending','date-descending']) assert.deepEqual(ids(sortLoadedItems(items,mode)),['有效','无日期','不可读','非法日期']);
});

test('排序保留多层子事项归属及子事项原顺序，不用子事项日期移动整个主事项',()=>{
  const items=[item('后主项','2030-01-16'),item('早子项','2029-01-01',null,2),item('孙项','2028-01-01',null,3),item('后子项','2031-01-01',null,2),item('前主项','2030-01-15'),item('另子项',null,null,2)];
  assert.deepEqual(ids(sortLoadedItems(items,'date-ascending')),['前主项','另子项','后主项','早子项','孙项','后子项']);
});

test('当前已加载部分从子事项开始时仍保留可见分组，不丢失缺少主项的记录',()=>{
  const items=[item('乙',null,null,2),item('乙的子项',null,null,3),item('甲',null,null,2),item('甲的子项',null,null,3),item('主项',null,null,1)];
  assert.deepEqual(ids(sortLoadedItems(items,'title-ascending')),['甲','甲的子项','乙','乙的子项','主项']);
});

test('同一排序值保留原顺序，中文标题与数字使用自然顺序',()=>{
  const items=[item('任务10'),item('任务2'),{...item('同值1'),title:'任务2'},item('任务1')];
  assert.deepEqual(ids(sortLoadedItems(items,'title-ascending')),['任务1','任务2','同值1','任务10']);
  assert.deepEqual(ids(sortLoadedItems(items,'title-descending')),['任务10','任务2','同值1','任务1']);
  assert.deepEqual(ids(sortLoadedItems(items,'date-descending')),ids(items));
});

test('优先级升降序使用高、中、低等级，无优先级与不可读始终在后，同级保持原序',()=>{
  const items=[['未知',null],['无','none'],['低','low'],['高一','high'],['中','medium'],['高二','high'],['非法','urgent']].map(([id,priority])=>Object.freeze({...item(id),priority}));
  Object.freeze(items);
  assert.deepEqual(ids(sortLoadedItems(items,'priority-descending')),['高一','高二','中','低','无','未知','非法']);
  assert.deepEqual(ids(sortLoadedItems(items,'priority-ascending')),['低','中','高一','高二','无','未知','非法']);
  assert.deepEqual(ids(sortLoadedItems(items,'manual')),['未知','无','低','高一','中','高二','非法']);
});

test('优先级排序按主事项移动连续子事项，不用高优先级子事项改变主项位置',()=>{
  const items=[{...item('无优先级主项'),priority:'none'},{...item('高子项',null,null,2),priority:'high'},{...item('低主项'),priority:'low'},{...item('未知子项',null,null,2),priority:null}];
  assert.deepEqual(ids(sortLoadedItems(items,'priority-descending')),['低主项','未知子项','无优先级主项','高子项']);
});

test('排序设置只保存固定模式，不保存清单或记录数据，重启恢复失败时使用清单顺序',()=>{
  const values=new Map();const storage={getStorageSync:key=>values.get(key),setStorageSync:(key,value)=>values.set(key,value)};
  assert.equal(readSortPreference(storage),'manual');
  assert.equal(saveSortPreference(storage,'date-descending'),true);
  assert.equal(readSortPreference(storage),'date-descending');
  assert.deepEqual([...values],[[SORT_PREFERENCE_KEY,'date-descending']]);
  assert.equal(saveSortPreference(storage,{mode:'manual',id:'合成记录'}),false);
  values.set(SORT_PREFERENCE_KEY,'合成未知设置');assert.equal(readSortPreference(storage),'manual');
  const broken={getStorageSync(){throw Error('合成不可读');},setStorageSync(){throw Error('合成不可写');}};
  assert.equal(readSortPreference(broken),'manual');assert.equal(saveSortPreference(broken,'manual'),false);
});
