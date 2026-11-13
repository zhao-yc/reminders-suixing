// #ifdef APP-HARMONY
import { REGIONS } from './origins.js';
import { normalizeCommand, parseNativeReply, nativeCommandScript } from './native-protocol.js';
import { collectSummary } from './collect-summary.mjs';

const failure = (code, message) => ({ ok: false, code, message });

/** 鸿蒙容器由原生 embed 持有，业务层仅更新固定配置并接收带实例标识的原生事件。 */
export function createHarmonyBridge({ adapterSource, timeoutMs = 18000, summaryEnabled = false, forgetSession }) {
  let host = null;
  let listener = null;
  let pending = null;
  let counter = 0;
  let ready = false;
  let needsRead = true;
  let disposed = false;
  let readingSummary = false;
  let loggingIn = false;
  let lastWriteAt = -Infinity;

  function publish(changes) {
    if (host) host = { ...host, ...changes };
    listener?.(host);
  }

  function unavailable(region, changing = false) {
    if (disposed) return failure('CLOSED', '连接已关闭。');
    if (!Object.prototype.hasOwnProperty.call(REGIONS, region)) return failure('INVALID_REGION', '不支持的服务区域。');
    if (pending && (changing || region !== host?.region)) return failure('BUSY', '上一项操作尚未结束，请等待结果后再切换或重载。');
    return null;
  }

  function settle(current, result) {
    if (pending !== current) return;
    pending = null;
    clearTimeout(current.timer);
    needsRead = !result.ok || !result.snapshot;
    publish({ packet: '' });
    current.resolve(result);
  }

  function interrupt(code) {
    needsRead = true;
    if (!pending) return;
    settle(pending, pending.write
      ? { ...failure('UNCERTAIN_WRITE', '官方页面已中断，操作结果未知。请核对并重新读取，不要重复提交。'), cloudConfirmed: false }
      : failure(code, '官方页面暂不可读取，请等待载入后刷新。'));
  }

  function handleHostEvent(event) {
    if (disposed || !host || event?.instanceId !== host.instanceId) return;
    if (event.type === 'loaded') { ready = event.official === true; return; }
    if (['loading', 'error', 'closed'].includes(event.type)) {
      ready = false;
      interrupt(event.type === 'closed' ? 'CLOSED' : 'PAGE_CHANGED');
      if (event.type === 'closed') { host = null; publish(); }
      return;
    }
    if (event.type === 'execute-error') {
      if (pending?.id === event.requestId) interrupt('BRIDGE_ERROR');
      return;
    }
    if (event.type !== 'reply' || !pending || event.official !== true) return;
    const current = pending;
    try {
      const result = parseNativeReply(event.payload, current.id);
      if (result) settle(current, current.write ? { ...result, cloudConfirmed: false } : result);
    } catch { interrupt('INVALID_REPLY'); }
  }

  async function execute(input, region = 'cn') {
    const command = normalizeCommand(input, {scopedReads:summaryEnabled});
    if (!command) return failure('INVALID_COMMAND', '不支持或不完整的操作。');
    const blocked = unavailable(region, true);
    if (blocked) return blocked;
    if (!host || host.region !== region || !ready) return failure('PAGE_NOT_READY', '请先打开官方页面，完成登录并等待页面载入。');
    if (readingSummary || loggingIn) return failure('BUSY','请等待当前读取结束。');
    if (!['read','readLists','selectList'].includes(command.type) && needsRead) return failure('READ_REQUIRED', '请先刷新，核对当前页面后再操作。');
    if (command.type==='setCompleted') lastWriteAt=Date.now();
    return dispatch(command);
  }

  function dispatch(command, limit = timeoutMs) {
    return new Promise(resolve => {
      const id = 'h-' + Date.now().toString(36) + '-' + (++counter);
      const current = { id, resolve, write: command.type === 'setCompleted' };
      pending = current;
      current.timer = setTimeout(() => {
        if (pending === current) interrupt('BRIDGE_TIMEOUT');
      }, limit);
      const request = summaryEnabled ? {...command,androidCompact:true} : command;
      publish({ packet: JSON.stringify({ id, action: 'execute', source: nativeCommandScript(adapterSource, request, id) }) });
    });
  }

  function ensure(region, visible) {
    if (!host || host.region !== region) {
      ready = false;
      needsRead = true;
      host = { instanceId: 'arkweb-' + (++counter), region, packet: '', visible };
    }
    publish({visible});
  }

  return {
    platform: 'HarmonyOS · 待真机验收', execute, handleHostEvent,
    async forgetAccount(region) {
      const blocked=unavailable(region,true);
      if (blocked || readingSummary || loggingIn || host?.visible) return blocked || failure('BUSY','请先返回随行。');
      ready=false;
      needsRead=true;
      host=null;
      publish();
      return {ok:forgetSession?.()===true};
    },
    async prepareSummary(region) {
      const blocked = unavailable(region,true);
      if (blocked || readingSummary || loggingIn || host?.visible || Date.now()-lastWriteAt<30000) return blocked || failure('AUTO_READ_DEFERRED','请稍后刷新。');
      const existing = host?.region === region;
      ensure(region,false);
      if (existing && ready) {
        const before=await dispatch({type:'readLists',background:true,sessionProbe:true},3000);
        if (host?.region!==region || host.visible) return failure('AUTO_READ_DEFERRED','请先返回随行。');
        if (!before.ok && before.code!=='PAGE_NOT_READY') return before;
        ready = false;
        publish({packet:JSON.stringify({id:'reload-' + (++counter), action:'reload', source:''})});
      }
      return {ok:true};
    },
    async readNavigation(region) {
      if (host?.region !== region || !ready || host.visible || pending) return failure('PAGE_NOT_READY','官方页面尚未就绪。');
      return dispatch({type:'readLists',background:true,sessionProbe:true},3000);
    },
    async readSummary(pageId,listId,region) {
      const current = host?.instanceId;
      const canRead = () => !!host && host.instanceId === current && host.region === region && ready && !host.visible;
      if (readingSummary || pending || loggingIn) return failure('BUSY','请等待当前读取结束。');
      readingSummary = true;
      try {
        return await collectSummary({pageId,listId},{canRead,timeoutMs:60000,
          read:(command,deadline)=>dispatch(command,Math.max(1,Math.min(timeoutMs,deadline-performance.now())))});
      } finally { readingSummary = false; }
    },
    async openLogin(region) {
      const blocked = unavailable(region,true);
      if (blocked || loggingIn || readingSummary) return blocked || failure('BUSY','请等待当前读取结束。');
      ensure(region,true);
      const current = host.instanceId;
      const active = () => host?.instanceId === current && host.visible;
      loggingIn = true;
      try {
        const deadline = Date.now() + 600000;
        while (active() && Date.now() < deadline) {
          if (ready) {
            const reply = await dispatch({type:'readLists',background:true},3000);
            if (active() && reply.ok && (reply.snapshot.lists.length || reply.snapshot.emptyAccount)) {
              publish({visible:false});
              return {...reply,code:'LOGIN_READY',initialSummary:true};
            }
          }
          if (active()) await new Promise(resolve=>setTimeout(resolve,750));
        }
        return failure(active()?'LOGIN_WAIT_TIMEOUT':'LOGIN_CANCELLED','请在官方页面完成登录。');
      } finally { loggingIn = false; }
    },
    onHostState(callback) { listener = callback; callback(host); return () => { if (listener === callback) listener = null; }; },
    async openSite(region = 'cn') {
      const blocked = unavailable(region);
      if (blocked) return blocked;
      ensure(region,true);
      return { ok: true };
    },
    hideSite() {
      if (disposed || !host?.visible) return false;
      publish({ visible: false });
      return true;
    },
    async reloadSite(region = 'cn') {
      const blocked = unavailable(region, true);
      if (blocked) return blocked;
      if (!host || host.region !== region) return failure('PAGE_NOT_READY', '请先打开官方页面。');
      ready = false;
      needsRead = true;
      publish({ packet: JSON.stringify({ id: 'reload-' + (++counter), action: 'reload', source: '' }) });
      return { ok: true, message: '官方页面正在重新加载，请稍后读取。' };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ready = false;
      interrupt('CLOSED');
      host = null;
      publish();
      listener = null;
    }
  };
}
// #endif
