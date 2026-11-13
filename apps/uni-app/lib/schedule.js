/** 日期保留公历年月日语义；只有带时间的提醒才绑定编辑器所在时区。 */
export function validSchedule(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'date,time,timeZone') return false;
  if (value.date === null) return value.time === null && value.timeZone === null;
  if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return false;
  const [year,month,day]=value.date.split('-').map(Number);
  const days=[31,year%4===0 && (year%100!==0 || year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month-1]) return false;
  if (value.time === null) return value.timeZone === null;
  return typeof value.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time) &&
    typeof value.timeZone === 'string' && /^[A-Za-z0-9_+/-]{1,80}$/.test(value.timeZone);
}

export function localDateString(date = new Date()) {
  return [String(date.getFullYear()).padStart(4,'0'),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}

/** 逻辑层取不到 IANA 时区时保留未知状态，避免按猜测的时区筛选实际事项。 */
export function localTimeZone() {
  return typeof Intl === 'undefined' ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 读取时间只需要本机小时和分钟，兼容没有国际化 API 的逻辑层。 */
export function localTimeString(date) {
  return [date.getHours(), date.getMinutes()].map(part => String(part).padStart(2, '0')).join(':');
}
