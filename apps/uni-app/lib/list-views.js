import { validSchedule, localDateString } from './schedule.js';

export const VIEW_OPTIONS = [
  {value:'pending',label:'未完成'}, {value:'today',label:'今天'},
  {value:'scheduled',label:'计划'}, {value:'completed',label:'已完成'}
];

/** 只筛选当前快照；不从附注猜日期，不读取详情或其他清单。 */
export function projectLoadedItems(items,options={}) {
  const view=VIEW_OPTIONS.some(option=>option.value===options.view)?options.view:'pending';
  const today=options.today || localDateString();
  const zone=options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query=(options.query || '').toLocaleLowerCase();
  const known=new Map();
  const valid=item=>{
    if(known.has(item))return known.get(item);
    let accepted=validSchedule(item.schedule);
    if(accepted && item.schedule.time!==null)try{new Intl.DateTimeFormat('en',{timeZone:item.schedule.timeZone});}catch{accepted=false;}
    known.set(item,accepted);return accepted;
  };
  const dated=item=>valid(item) && item.schedule.date!==null;
  // 指定时间来自读取时的本机时区；系统时区变化后不沿用旧日历日归类。
  const dayKnown=item=>valid(item) && (item.schedule.time===null || item.schedule.timeZone===zone);
  const dueToday=item=>dated(item) && dayKnown(item) && item.schedule.date<=today;
  const pending=items.filter(item=>item.completed===false);
  const counts={pending:pending.length,today:pending.filter(dueToday).length,scheduled:pending.filter(dated).length,completed:items.filter(item=>item.completed===true).length};
  const unknownDates=pending.filter(item=>!valid(item)).length;
  const unknownToday=pending.filter(item=>!dayKnown(item)).length;
  const base=items.filter(item=>view==='completed'?item.completed===true:item.completed===false && (view==='today'?dueToday(item):view==='scheduled'?dated(item):true));
  const matches=new Set(base.filter(item=>(!options.flagOnly || item.flagged===true) && (!query || (item.title+' '+(item.notes || '')).toLocaleLowerCase().includes(query))).map(item=>item.id));
  const included=new Set(matches),ancestors=[];
  for(const item of items) {
    const level=Number.isInteger(item.level) && item.level>0?item.level:1;
    while(ancestors.length && ancestors[ancestors.length-1].level>=level)ancestors.pop();
    if(matches.has(item.id))for(const ancestor of ancestors)included.add(ancestor.id);
    ancestors.push({id:item.id,level});
  }
  return {items:items.filter(item=>included.has(item.id)),contextIds:new Set([...included].filter(id=>!matches.has(id))),matchCount:matches.size,counts,unknownDates,unknownToday,flaggedCount:base.filter(item=>item.flagged===true).length};
}
