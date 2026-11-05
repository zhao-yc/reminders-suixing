import { validSchedule } from './schedule.js';
import { priorityInfo } from './priority.js';

export const SORT_PREFERENCE_KEY = 'suixing.settings.listSort';
export const SORT_OPTIONS = [
  { value:'manual', label:'清单顺序' },
  { value:'date-ascending', label:'日期：从早到晚' },
  { value:'date-descending', label:'日期：从晚到早' },
  { value:'title-ascending', label:'标题：升序' },
  { value:'title-descending', label:'标题：降序' },
  { value:'priority-descending', label:'优先级：从高到低' },
  { value:'priority-ascending', label:'优先级：从低到高' }
];
const validMode = mode => SORT_OPTIONS.some(option => option.value === mode);
const titles = new Intl.Collator('zh-CN', { numeric:true, sensitivity:'base' });

export function readSortPreference(storage) {
  try {
    const mode = storage.getStorageSync(SORT_PREFERENCE_KEY);
    return validMode(mode) ? mode : 'manual';
  } catch { return 'manual'; }
}

export function saveSortPreference(storage, mode) {
  if (!validMode(mode)) return false;
  try {
    storage.setStorageSync(SORT_PREFERENCE_KEY, mode);
    return storage.getStorageSync(SORT_PREFERENCE_KEY) === mode;
  } catch { return false; }
}

function dateRank(item) {
  if (!validSchedule(item.schedule)) return 2;
  return item.schedule.date === null ? 1 : 0;
}

/** 只重排显示引用，主事项与其连续的子事项一起移动；不修改快照、记录或云端顺序。 */
export function sortLoadedItems(items, mode) {
  if (!validMode(mode) || mode === 'manual') return items.slice();
  const groups = [];
  for (const item of items) {
    const level = Number.isInteger(item.level) && item.level > 0 ? item.level : 1;
    const last = groups[groups.length-1];
    if (!last || level <= last.level) groups.push({ level, root:item, items:[item], index:groups.length });
    else last.items.push(item);
  }
  const direction = mode.endsWith('descending') ? -1 : 1;
  groups.sort((left,right) => {
    let order;
    if (mode.startsWith('title-')) order = titles.compare(left.root.title,right.root.title) * direction;
    else if(mode.startsWith('priority-')) {
      const a=priorityInfo(left.root.priority).rank,b=priorityInfo(right.root.priority).rank;
      const rank=value=>value===null?2:value===0?1:0;
      if(rank(a)!==rank(b)) return rank(a)-rank(b);
      order=a===null || a===0?0:(a-b)*direction;
    }
    else {
      const leftRank = dateRank(left.root), rightRank = dateRank(right.root);
      // 无日期及不可读日期始终在后，倒序也不将其误当成最晚日期。
      if (leftRank !== rightRank) return leftRank-rightRank;
      if (leftRank !== 0) return left.index-right.index;
      const a = left.root.schedule, b = right.root.schedule;
      order = (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * direction;
      // 同一天的全天事项在指定时间之前；指定时间按选定方向排列。
      if (!order && (a.time === null) !== (b.time === null)) return a.time === null ? -1 : 1;
      if (!order && a.time !== b.time) order = (a.time < b.time ? -1 : 1) * direction;
    }
    return order || left.index-right.index;
  });
  return groups.flatMap(group => group.items);
}
