const VERSION = 1;
const accountId = /^(?:legacy-(?:cn|global)|[a-z0-9]{20,48})$/;
const regionCodes = ['cn', 'global'];
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';

export function validLocalAccount(account) {
  return !!account && typeof account.id === 'string' && accountId.test(account.id) && regionCodes.includes(account.region) &&
    (!account.id.startsWith('legacy-') || account.id === 'legacy-' + account.region);
}

export function listIdentity(list) {
  return JSON.stringify([list.title, list.color || '', list.icon?.key || '']);
}

export function matchingList(lists, list) {
  const matches = lists.filter(entry => listIdentity(entry) === listIdentity(list));
  return matches.length === 1 ? matches[0] : null;
}

/** 只投影显示字段，页面句柄和写入指纹始终留在实时桥接中。 */
export function toLocalReport(account, report) {
  const lists = report.lists.map(({ list, items, partial }, listIndex) => {
    const id = account.id + ':' + listIndex;
    const ids = new Map(items.map((item, index) => [item.id, id + ':' + index]));
    return {
      list: {
        id, accountId: account.id, title: text(list.title, 1000),
        color: /^#[a-f0-9]{3,8}$|^rgba?\([\d.,\s]+\)$/i.test(list.color || '') ? list.color : '#1687ff',
        icon: list.icon?.key ? { key: text(list.icon.key, 100), svg: text(list.icon.svg, 60000) } : null
      },
      partial: partial === true,
      items: items.map(item => ({
        id: ids.get(item.id), listId: id, title: text(item.title, 4000), notes: text(item.notes, 2000),
        notesTruncated: item.notesTruncated === true, metadata: text(item.metadata, 2000),
        metadataPartial: item.metadataPartial === true, completed: item.completed === true,
        flagged: typeof item.flagged === 'boolean' ? item.flagged : null,
        priority: ['high','medium','low','none'].includes(item.priority) ? item.priority : null,
        level: Number.isInteger(item.level) ? item.level : 1, parentId: ids.get(item.parentId) || null,
        schedule: item.schedule ? {
          date: text(item.schedule.date, 10) || null, time: text(item.schedule.time, 5) || null,
          timeZone: text(item.schedule.timeZone, 80) || null
        } : null,
        disabled: item.disabled === true
      }))
    };
  });
  return { version: VERSION, accountId: account.id, capturedAt: report.capturedAt, totalLists: report.totalLists, lists };
}

export function incompleteReport(report) {
  return report.lists.length !== report.totalLists || report.lists.some(entry => entry.partial);
}

/** 刷新先重载既有官方页，再等清单导航就绪。 */
export async function prepareNavigation(bridge, account) {
  const { region, id } = account;
  const opened = await bridge.prepareSummary(region, id);
  if (!opened.ok) return opened;
  const deadline = Date.now() + 18000;
  do {
    const navigation = await bridge.readNavigation(region, id);
    if (navigation.ok && (navigation.snapshot?.lists?.length || navigation.snapshot?.emptyAccount)) return navigation;
    if (!['PAGE_NOT_READY', 'LIST_LOADING', 'SELECT_A_LIST', 'PAGE_CHANGED'].includes(navigation.code)) return navigation;
    await new Promise(resolve => setTimeout(resolve, 400));
  } while (Date.now() < deadline);
  return {ok:false,code:'PAGE_NOT_READY'};
}

export async function refreshOfficial(bridge, account, initial) {
  const { region, id } = account;
  const navigation = initial || await prepareNavigation(bridge,account);
  if (!navigation.ok) return navigation;
  if (!navigation.ok || !navigation.snapshot?.pageId ||
      (!navigation.snapshot.lists.length && !navigation.snapshot.emptyAccount)) return { ok: false, code: 'PAGE_NOT_READY' };
  const result = await bridge.readSummary(navigation.snapshot.pageId, '', region, id);
  return { ...result, navigation: navigation.snapshot };
}

export function createLocalStore(files) {
  const registryKey = 'accounts';
  const key = account => 'snapshot-' + account.id;
  async function read(name) {
    try {
      const value = JSON.parse(await files.read(name));
      return value?.version === VERSION ? value : null;
    } catch { return null; }
  }
  return {
    async accounts() {
      const value = await read(registryKey);
      if (!Array.isArray(value?.accounts)) return null;
      const ids = new Set();
      return value.accounts.filter(account => {
        if (!validLocalAccount(account) || ids.has(account.id)) return false;
        ids.add(account.id);
        return true;
      }).map(account => ({
        id: account.id, region: account.region, label: text(account.label, 48) || 'iCloud',
        confirmed: account.confirmed === true, verify: account.verify === true
      }));
    },
    saveAccounts(accounts) { return files.write(registryKey, JSON.stringify({ version: VERSION, accounts })); },
    async report(account) {
      const value = await read(key(account));
      if (value?.accountId !== account.id || !Array.isArray(value.lists) ||
          !Number.isInteger(value.totalLists) || value.totalLists < value.lists.length || !Number.isFinite(Date.parse(value.capturedAt)) ||
          !value.lists.every((entry,index) => entry?.list?.accountId === account.id && entry.list.id === account.id + ':' + index &&
            typeof entry.list.title === 'string' && Array.isArray(entry.items) &&
            entry.items.every(item=>item && item.listId===entry.list.id && typeof item.title==='string' && typeof item.completed==='boolean'))) return null;
      return value;
    },
    saveReport(account, report) { return files.write(key(account), JSON.stringify(report)); },
    removeReport(account) { return files.remove(key(account)); }
  };
}

/** 同一次刷新可由启动、手动入口和登录交接共享，逐个账号独立提交。 */
export function createAccountRefresh({ collect, previous, save, update, active }) {
  let running;
  let started = false;
  function refresh(accounts) {
    if (running) return running;
    running = (async () => {
      for (const account of accounts) {
        let result;
        try { result = await collect(account); }
        catch { result = { ok: false, code: 'CONNECTION_FAILED' }; }
        if (!active(account)) continue;
        if (!result.ok || !result.summary) {
          update(account, null, result.code, result);
          continue;
        }
        const report = toLocalReport(account, result.summary);
        if (incompleteReport(report) && previous(account)) {
          update(account, null, 'PARTIAL', result);
          continue;
        }
        let code = incompleteReport(report) ? 'PARTIAL' : 'READY';
        try { await save(account, report); }
        catch { code = 'CACHE_WRITE_FAILED'; }
        if (active(account)) update(account, report, code, result);
      }
    })().finally(() => { running = null; });
    return running;
  }
  return {
    refresh,
    start(accounts) {
      if (started) return running;
      started = true;
      return refresh(accounts);
    }
  };
}
