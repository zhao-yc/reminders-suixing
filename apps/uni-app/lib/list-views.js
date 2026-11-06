import { validSchedule, localDateString } from './schedule.js';

export const VIEW_OPTIONS = [
  {value:'pending',label:'未完成'}, {value:'today',label:'今天'},
  {value:'scheduled',label:'计划'}, {value:'completed',label:'已完成'},
  {value:'overdue',label:'逾期',desktopOnly:true}
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
  const overdue=item=>dueToday(item) && item.schedule.date<today;
  const pending=items.filter(item=>item.completed===false);
  const counts={pending:pending.length,today:pending.filter(dueToday).length,scheduled:pending.filter(dated).length,
    completed:items.filter(item=>item.completed===true).length,overdue:pending.filter(overdue).length,flagged:pending.filter(item=>item.flagged===true).length};
  const unknownDates=pending.filter(item=>!valid(item)).length;
  const unknownToday=pending.filter(item=>!dayKnown(item)).length;
  const matchesDate={today:dueToday,scheduled:dated,overdue};
  const base=view==='completed' ? items.filter(item=>item.completed===true) : pending.filter(item=>matchesDate[view]?.(item) ?? true);
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

const TODAY_SECTIONS = ['逾期','全天','上午','下午','今晚'];
const UNKNOWN_ZONE = '时区待核对';

/** 只重排已筛出的行。每组主子事项以首个匹配事项为归组依据，保留原行引用与层级。 */
export function groupLoadedDateView({items,contextIds},{view,today,tomorrow,timeZone,descending=false}) {
  const headings = new Map();
  if (view !== 'today' && view !== 'scheduled') return {items,headings};
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sections = new Map();
  let family = [], rootLevel = 1;

  function addFamily() {
    const matched = family.find(item => !contextIds.has(item.id));
    if (!matched) return;
    const {date,time,timeZone:itemZone} = matched.schedule;
    let key = date;
    if (view === 'today') {
      if (date < today) key = '逾期';
      else if (time === null) key = '全天';
      else if (time < '12:00') key = '上午';
      else if (time < '18:00') key = '下午';
      else key = '今晚';
    } else if (time !== null && itemZone !== zone) {
      key = UNKNOWN_ZONE;
    }
    if (!sections.has(key)) sections.set(key,[]);
    sections.get(key).push(...family);
  }

  for (const item of items) {
    const level = Number.isInteger(item.level) && item.level > 0 ? item.level : 1;
    if (!family.length || level <= rootLevel) {
      addFamily();
      family = [];
      rootLevel = level;
    }
    family.push(item);
  }
  addFamily();
  const keys = view === 'today' ? TODAY_SECTIONS : [...sections.keys()].filter(key => key !== UNKNOWN_ZONE).sort();
  if (view === 'scheduled') {
    if (descending) keys.reverse();
    keys.push(UNKNOWN_ZONE);
  }
  const grouped = [];
  for (const key of keys) {
    const section = sections.get(key);
    if (!section) continue;
    let label = key;
    if (view === 'scheduled' && key === today) label = '今天';
    if (view === 'scheduled' && key === tomorrow) label = '明天';
    headings.set(section[0].id,label);
    grouped.push(...section);
  }
  return {items:grouped,headings};
}
