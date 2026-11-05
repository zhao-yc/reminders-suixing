/** 原生容器之间共用的数据协议；此模块不提供网页可调用的原生 API。 */
export const REPLY_PREFIX = 'suixingbridge://reply?payload=';
export const MAX_PAYLOAD = 110000;

export function isNativeWrite(type) {
  return type === 'setCompleted' || type === 'setText' || type === 'setFlagged';
}

export function normalizeCommand(command, { scopedReads = false, itemEdits = false } = {}) {
  if (!command || typeof command !== 'object') return null;
  const { type } = command;
  if (type === 'read' || (scopedReads && type === 'readLists')) return { type };
  const bounded = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
  if (!bounded(command.pageId, 150) || !bounded(command.listId, 150)) return null;
  const result = { type, pageId: command.pageId, listId: command.listId };
  if (type === 'selectList' || (scopedReads && type === 'readList')) return result;
  if (!isNativeWrite(type) || (type !== 'setCompleted' && !itemEdits)) return null;
  const { id, fingerprint, expectedCompleted } = command;
  if (!bounded(id, 1024) || !bounded(fingerprint, 16000) || typeof expectedCompleted !== 'boolean') return null;
  const target = { ...result, id, fingerprint, expectedCompleted };
  if (type === 'setCompleted') return typeof command.completed === 'boolean' ? { ...target, completed: command.completed } : null;
  if (type === 'setFlagged') {
    const { flagged, expectedFlagged } = command;
    return typeof flagged === 'boolean' && typeof expectedFlagged === 'boolean' ? { ...target, flagged, expectedFlagged } : null;
  }
  const { field, value } = command;
  if (!['title', 'notes'].includes(field) || typeof value !== 'string' || value.length > (field === 'title' ? 1000 : 2000) ||
      (field === 'title' && (!value.trim() || /[\r\n]/.test(value)))) return null;
  return { ...target, field, value };
}

/** 不匹配的旧回执返回 null；损坏或超限的当前回执交给容器按操作类型结束。 */
export function parseNativeReply(payload, requestId) {
  if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD) throw new Error('回执超限');
  const envelope = JSON.parse(decodeURIComponent(payload));
  if (envelope.requestId !== requestId) return null;
  const result = envelope.result;
  if (!result || typeof result.ok !== 'boolean' || typeof result.code !== 'string' ||
      (result.ok && (!result.snapshot || typeof result.snapshot.pageId !== 'string' ||
        !Array.isArray(result.snapshot.lists) || !Array.isArray(result.snapshot.items)))) throw new Error('回执不完整');
  return result;
}

/** 仅将固定命令交给唯一共享适配器，结果用被原生拦截的 URL 返回，不注入原生对象。 */
export function nativeCommandScript(adapterSource, command, requestId) {
  const write = isNativeWrite(command.type);
  const oversized = write
    ? { ok: false, code: 'UNCERTAIN_WRITE', cloudConfirmed: false, message: '修改回执超出传输范围，请先在官方页面核对，不要重复提交。' }
    : { ok: false, code: 'PAYLOAD_TOO_LARGE', message: '当前列表超出传输范围，请选择较小清单。' };
  return adapterSource + '\n' +
    '(function(){var id=' + JSON.stringify(requestId) + ';function reply(result){' +
    'var payload=encodeURIComponent(JSON.stringify({requestId:id,result:result}));' +
    'if(payload.length>' + MAX_PAYLOAD + ')payload=encodeURIComponent(JSON.stringify({requestId:id,result:' + JSON.stringify(oversized) + '}));' +
    'location.href=' + JSON.stringify(REPLY_PREFIX) + '+payload;}' +
    'Promise.resolve().then(function(){return window.__suixingAdapter.execute(' + JSON.stringify(command) + ');})' +
    '.then(reply,function(){reply({ok:false,code:' + JSON.stringify(write ? 'UNCERTAIN_WRITE' : 'PAGE_CHANGED') +
    ',cloudConfirmed:false,message:"页面响应异常，请核对后重新读取。"});});})();';
}
