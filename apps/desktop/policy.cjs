/** 只允许官方 HTTPS 域名，不放行相似域名或本地协议。 */
function allowedURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (!url.port || url.port === '443') &&
      ['icloud.com', 'icloud.com.cn', 'apple.com', 'apple.com.cn'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch { return false; }
}

/** 官方跨站登录需要 Cookie 存储；该许可只限 Apple 页面之间，不开放相机、剪贴板或文件权限。 */
function allowStorage(permission, requestingURL, embeddingURL) {
  return ['storage-access', 'top-level-storage-access'].includes(permission) && allowedURL(requestingURL) && allowedURL(embeddingURL);
}

/** 报告实际 Chromium 内核版本，去除站点不认识的 Electron／应用产品标识。 */
function browserUserAgent(chromiumVersion) {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chromiumVersion + ' Safari/537.36';
}

function validCommand(command) {
  if (!command || typeof command !== 'object' || !['read','readLists', 'selectList', 'showCompleted', 'getSchedule', 'getDeleteInfo', 'deleteItem', 'createList', 'renameList','deleteList','getListAppearance','setListAppearance', 'setSchedule', 'setFlagged', 'setCompleted', 'setText', 'createItem'].includes(command.type)) return false;
  if (['read','readLists'].includes(command.type)) return true;
  if (typeof command.pageId !== 'string' || command.pageId.length > 150 || typeof command.listId !== 'string' || command.listId.length > 150) return false;
  if (['selectList', 'showCompleted'].includes(command.type)) return true;
  if(['getListAppearance','setListAppearance'].includes(command.type))return typeof command.expectedListFingerprint==='string' && command.expectedListFingerprint.length>0 && command.expectedListFingerprint.length<=4000 &&
    (command.type==='getListAppearance' || typeof command.color==='string' && /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/.test(command.color) && typeof command.iconKey==='string' && /^shape-[a-f0-9]+-[a-f0-9]+-\d{1,5}$/.test(command.iconKey) && typeof command.expectedAppearanceFingerprint==='string' && command.expectedAppearanceFingerprint.length>0 && command.expectedAppearanceFingerprint.length<=20000 && typeof command.requestId==='string' && /^[a-z0-9-]{1,100}$/.test(command.requestId));
  if(command.type==='deleteList') return command.confirmed===true && typeof command.expectedListFingerprint==='string' && command.expectedListFingerprint.length>0 && command.expectedListFingerprint.length<=4000 &&
    typeof command.requestId==='string' && /^[a-z0-9-]{1,100}$/.test(command.requestId);
  if(['createList','renameList'].includes(command.type)) return typeof command.expectedListFingerprint==='string' && command.expectedListFingerprint.length>0 && command.expectedListFingerprint.length<=4000 &&
    typeof command.value==='string' && command.value.trim().length>0 && command.value.length<=100 && !/[\r\n]/.test(command.value) && typeof command.requestId==='string' && /^[a-z0-9-]{1,100}$/.test(command.requestId);
  if (command.type === 'createItem') return typeof command.title === 'string' && command.title.trim().length > 0 && command.title.length <= 1000 && !/[\r\n]/.test(command.title) &&
    typeof command.requestId === 'string' && /^[a-z0-9-]{1,100}$/.test(command.requestId);
  const target = typeof command.id === 'string' && command.id.length > 0 && command.id.length <= 1024 && typeof command.fingerprint === 'string' &&
    command.fingerprint.length <= 16000 && typeof command.expectedCompleted === 'boolean';
  if (['getSchedule','getDeleteInfo'].includes(command.type)) return target;
  if (command.type === 'deleteItem') return target && command.confirmed===true && typeof command.requestId==='string' && /^[a-z0-9-]{1,100}$/.test(command.requestId);
  if (command.type === 'setFlagged') return target && typeof command.flagged === 'boolean' && typeof command.expectedFlagged === 'boolean';
  if (command.type === 'setSchedule') {
    const schedule=value=>value && typeof value==='object' && Object.keys(value).sort().join(',')==='date,time,timeZone' &&
      (value.date===null ? value.time===null && value.timeZone===null : typeof value.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
       (value.time===null ? value.timeZone===null : typeof value.time==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time) && typeof value.timeZone==='string' && /^[A-Za-z0-9_+/-]{1,80}$/.test(value.timeZone)));
    return !!(target && schedule(command.value) && schedule(command.expectedSchedule) && typeof command.expectedScheduleFingerprint==='string' && command.expectedScheduleFingerprint.length>0 && command.expectedScheduleFingerprint.length<=200);
  }
  if (command.type === 'setText') return target && ['title', 'notes'].includes(command.field) && typeof command.value === 'string' &&
    command.value.length <= (command.field === 'title' ? 1000 : 2000) && (command.field !== 'title' || (command.value.trim().length > 0 && !/[\r\n]/.test(command.value)));
  return target && typeof command.completed === 'boolean';
}

module.exports = { allowedURL, allowStorage, browserUserAgent, validCommand };
