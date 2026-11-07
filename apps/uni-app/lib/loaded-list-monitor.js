/** 自动更新绑定用户选中的清单。只有允许重载的平台才会低频请求新页面。 */
export function monitorLoadedList({ state, read, started, finished, received, failed }, options = {}) {
  const schedule = options.setInterval || globalThis.setInterval;
  const unschedule = options.clearInterval || globalThis.clearInterval;
  const now = options.now || (()=>Date.now());
  let stopped = false, pending = false, lastAttempt = -Infinity;
  let scope = '', lastReloadAttempt = 0;
  const eligible = value => value.enabled && value.visible && value.live && !value.demo && !value.editing && !value.recovery &&
    ['cn', 'global'].includes(value.region) && !!value.snapshot?.pageId && !!value.snapshot?.activeListId;
  const sameScope = (before, after) => before.region === after.region && before.snapshot === after.snapshot;
  const same = (before, after) => eligible(after) && sameScope(before, after) && before.revision === after.revision;
  const selectionRequired = {ok:false,code:'RELOAD_SELECT_LIST',needsListSelection:true,message:'请刷新清单导航后重新选择原清单。'};

  async function check() {
    if (stopped || pending) return;
    const before = state();
    if (!eligible(before) || before.busy || now() - lastAttempt < 3000 || now() - Date.parse(before.snapshot.capturedAt) < 3000) return;
    const key = JSON.stringify([before.region,before.snapshot.pageId,before.snapshot.activeListId]);
    if (scope !== key) { scope = key; lastReloadAttempt = now(); }
    const reload = before.allowReload === true && now() - lastReloadAttempt >= 120000;
    const previousReloadAttempt = lastReloadAttempt;
    if (reload) lastReloadAttempt = now();
    pending = true; lastAttempt = now(); started();
    try {
      const request = { type: 'readList', pageId: before.snapshot.pageId, listId: before.snapshot.activeListId, background: true };
      if (reload) request.reload = true;
      const result = await read(request, before.region);
      if (stopped) return;
      const after = state();
      if (reload && result?.reloaded === true && sameScope(before,after)) {
        // 导航已发生，即使窗口此时隐藏，也要换掉旧页面句柄或要求重新选择。
        const snapshot = result.snapshot;
        if (same(before,{...after,visible:true}) && result.ok && !result.needsListSelection && snapshot?.pageId &&
            snapshot.pageId !== before.snapshot.pageId && snapshot.activeListId && snapshot.activeListTitle === before.snapshot.activeListTitle) received(result);
        else failed(result.ok ? selectionRequired : result);
        return;
      }
      if (['AUTO_READ_DEFERRED', 'BUSY'].includes(result?.code)) {
        if(result.reason==='window-hidden') { lastAttempt=-Infinity; lastReloadAttempt=previousReloadAttempt; }
        return;
      }
      if (!same(before, after)) return;
      if (result?.ok && result.snapshot?.pageId === before.snapshot.pageId && result.snapshot.activeListId === before.snapshot.activeListId && !result.needsListSelection) received(result);
      else failed(result?.ok ? { ok: false, code: 'STALE_VIEW', message: '官方页面位置已变化，请刷新核对。' } : result || { ok: false, code: 'CONNECTION_FAILED', message: '自动更新暂时不可用，请刷新核对。' });
    } catch {
      if (!stopped) {
        const after = state();
        if (reload && sameScope(before,after)) failed(selectionRequired);
        else if (same(before,after)) failed({ ok: false, code: 'CONNECTION_FAILED', message: '自动更新暂时不可用，请刷新核对。' });
      }
    } finally { pending = false; finished(); }
  }
  const timer = schedule(check, 20000);
  return { check, stop() { stopped = true; unschedule(timer); } };
}
