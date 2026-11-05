/** 自动读取只绑定已由用户选中的页面与清单，不导航、不展开或重放写入。 */
export function monitorLoadedList({ state, read, started, finished, received, failed }, options = {}) {
  const schedule = options.setInterval || globalThis.setInterval;
  const unschedule = options.clearInterval || globalThis.clearInterval;
  const now = options.now || Date.now;
  let stopped = false, pending = false, lastAttempt = -Infinity;
  const eligible = value => value.enabled && value.visible && value.live && !value.demo && !value.editing && !value.recovery &&
    ['cn', 'global'].includes(value.region) && !!value.snapshot?.pageId && !!value.snapshot?.activeListId;
  const same = (before, after) => eligible(after) && before.region === after.region && before.revision === after.revision && before.snapshot === after.snapshot;

  async function check() {
    if (stopped || pending) return;
    const before = state();
    if (!eligible(before) || before.busy || now() - lastAttempt < 3000 || now() - Date.parse(before.snapshot.capturedAt) < 3000) return;
    pending = true; lastAttempt = now(); started();
    try {
      const result = await read({ type: 'readList', pageId: before.snapshot.pageId, listId: before.snapshot.activeListId, background: true }, before.region);
      if (stopped || !same(before, state())) return;
      if (['AUTO_READ_DEFERRED', 'BUSY'].includes(result?.code)) {
        if(result.reason==='window-hidden')lastAttempt=-Infinity;
        return;
      }
      if (result?.ok && result.snapshot?.pageId === before.snapshot.pageId && result.snapshot.activeListId === before.snapshot.activeListId && !result.needsListSelection) received(result);
      else failed(result?.ok ? { ok: false, code: 'STALE_VIEW', message: '官方页面位置已变化，请刷新核对。' } : result || { ok: false, code: 'CONNECTION_FAILED', message: '自动更新暂时不可用，请刷新核对。' });
    } catch {
      if (!stopped && same(before, state())) failed({ ok: false, code: 'CONNECTION_FAILED', message: '自动更新暂时不可用，请刷新核对。' });
    } finally { pending = false; finished(); }
  }
  const timer = schedule(check, 20000);
  return { check, stop() { stopped = true; unschedule(timer); } };
}
