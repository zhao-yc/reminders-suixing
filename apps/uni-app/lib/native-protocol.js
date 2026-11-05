/** 原生容器之间共用的数据协议；此模块不提供网页可调用的原生 API。 */
export const REPLY_PREFIX = 'suixingbridge://reply?payload=';
export const MAX_PAYLOAD = 110000;

export function normalizeCommand(command, { scopedReads = false } = {}) {
  if (!command || typeof command !== 'object') return null;
  if (command.type === 'read' || (scopedReads && command.type === 'readLists')) return { type: command.type };
  const bounded = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
  if (!bounded(command.pageId, 150) || !bounded(command.listId, 150)) return null;
  const result = { type: command.type, pageId: command.pageId, listId: command.listId };
  if (command.type === 'selectList' || (scopedReads && command.type === 'readList')) return result;
  if (command.type !== 'setCompleted' || !bounded(command.id, 1024) || !bounded(command.fingerprint, 16000) ||
      typeof command.expectedCompleted !== 'boolean' || typeof command.completed !== 'boolean') return null;
  return { ...result, id: command.id, fingerprint: command.fingerprint,
    expectedCompleted: command.expectedCompleted, completed: command.completed };
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
  return adapterSource + '\n' +
    '(function(){var id=' + JSON.stringify(requestId) + ';function reply(result){' +
    'var payload=encodeURIComponent(JSON.stringify({requestId:id,result:result}));' +
    'if(payload.length>' + MAX_PAYLOAD + ')payload=encodeURIComponent(JSON.stringify({requestId:id,result:{ok:false,code:"PAYLOAD_TOO_LARGE",message:"当前列表超出传输范围，请选择较小清单。"}}));' +
    'location.href=' + JSON.stringify(REPLY_PREFIX) + '+payload;}' +
    'Promise.resolve().then(function(){return window.__suixingAdapter.execute(' + JSON.stringify(command) + ');})' +
    '.then(reply,function(){reply({ok:false,code:' + JSON.stringify(command.type === 'setCompleted' ? 'UNCERTAIN_WRITE' : 'PAGE_CHANGED') +
    ',cloudConfirmed:false,message:"页面响应异常，请核对后重新读取。"});});})();';
}
