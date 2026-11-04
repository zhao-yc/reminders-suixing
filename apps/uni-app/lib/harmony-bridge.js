// #ifdef APP-HARMONY
import { REGIONS } from './origins.js';
import { normalizeCommand, parseNativeReply, nativeCommandScript } from './native-protocol.js';

const failure = (code, message) => ({ ok: false, code, message });

/** 鸿蒙容器由原生 embed 持有，业务层仅更新固定配置并接收带实例标识的原生事件。 */
export function createHarmonyBridge({ adapterSource, timeoutMs = 18000 }) {
  let host = null;
  let listener = null;
  let pending = null;
  let counter = 0;
  let ready = false;
  let needsRead = true;
  let disposed = false;

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
    const command = normalizeCommand(input);
    if (!command) return failure('INVALID_COMMAND', '不支持或不完整的操作。');
    const blocked = unavailable(region, true);
    if (blocked) return blocked;
    if (!host || host.region !== region || !ready) return failure('PAGE_NOT_READY', '请先打开官方页面，完成登录并等待页面载入。');
    if (command.type !== 'read' && needsRead) return failure('READ_REQUIRED', '请先刷新，核对当前页面后再操作。');
    return new Promise(resolve => {
      const id = 'h-' + Date.now().toString(36) + '-' + (++counter);
      const current = { id, resolve, write: command.type === 'setCompleted' };
      pending = current;
      current.timer = setTimeout(() => {
        if (pending === current) interrupt('BRIDGE_TIMEOUT');
      }, timeoutMs);
      publish({ packet: JSON.stringify({ id, action: 'execute', source: nativeCommandScript(adapterSource, command, id) }) });
    });
  }

  return {
    platform: 'HarmonyOS · 待真机验收', execute, handleHostEvent,
    onHostState(callback) { listener = callback; callback(host); return () => { if (listener === callback) listener = null; }; },
    async openSite(region = 'cn') {
      const blocked = unavailable(region);
      if (blocked) return blocked;
      if (!host || host.region !== region) {
        ready = false;
        needsRead = true;
        host = { instanceId: 'arkweb-' + (++counter), region, packet: '', visible: true };
      }
      publish({ visible: true });
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
