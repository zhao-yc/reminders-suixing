import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createAndroidBridge } from '../apps/uni-app/lib/android-bridge.js';
import { reconnectLoadedList } from '../apps/uni-app/lib/reconnect.js';

const source = await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js', import.meta.url), 'utf8');
const fixture = await fs.readFile(new URL('./fixtures/reminders.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = () => ({ pageId: 'synthetic-page', activeListId: 'synthetic-list', lists: [], items: [] });
const readResult = () => ({ ok: true, code: 'READY', snapshot: snapshot() });
const targetCommand = { pageId: 'synthetic-page', listId: 'synthetic-list',
  id: 'synthetic-item', fingerprint: 'synthetic-fingerprint', expectedCompleted: false };
const writeCommand = () => ({ ...targetCommand, type: 'setCompleted', completed: true });

/** 只替代原生传输；注入脚本确实执行，并通过拦截的 URL 回到同一窗口。 */
function setup(t, options = {}) {
  const views = [];
  const runtime = { networkinfo: options.networkinfo, webview: { create(url, id, styles) {
    const listeners = new Map();
    const view = {
      id, styles, scripts: [], calls: [], replies: [], loads: [], closed: 0, shown: 0, hidden: 0, reloads: 0,
      emit(event) { for (const listener of listeners.get(event) || []) listener(); },
      addEventListener(event, callback) { listeners.set(event, [...(listeners.get(event) || []), callback]); },
      overrideUrlLoading(policy, callback) {
        if (options.failFirstSetup && views.length === 1) throw new Error('合成窗口配置失败');
        this.policy = policy; this.receive = callback;
      },
      getURL() { return this.url; },
      loadURL(value) { this.loads.push(value); this.url = value; this.emit('loading'); },
      close() { this.closed++; this.emit('close'); },
      show() { this.shown++; }, hide() { this.hidden++; },
      reload() { this.reloads++; this.emit('loading'); },
      evalJS(script) {
        this.scripts.push(script);
        if (this.throwOnEval) throw new Error('合成执行失败');
        vm.runInContext(script, this.context);
      }
    };
    const window = options.realAdapter
      ? new JSDOM(fixture, { url: 'https://www.icloud.com.cn/reminders/', runScripts: 'dangerously' }).window
      : { __suixingAdapter: { execute(command) { return new Promise((resolve, reject) => view.calls.push({ command, resolve, reject })); } } };
    const location = { set href(value) { view.replies.push(value); view.receive({ url: value }); } };
    view.context = vm.createContext({ window, location, setTimeout, clearTimeout });
    view.window = window;
    views.push(view);
    return view;
  } } };
  const bridge = createAndroidBridge({ runtime, adapterSource: options.realAdapter ? source : '', timeoutMs: options.timeoutMs || 1000 });
  t.after(() => { bridge.dispose(); for (const view of views) view.window.close?.(); });
  return { bridge, views,
    async open(region = 'cn') { assert.equal((await bridge.openSite(region)).ok, true); const view = views.at(-1); view.emit('loaded'); return view; },
    async read(view) { const result = bridge.execute({ type: 'read' }); await tick(); view.calls.at(-1).resolve(readResult()); return result; }
  };
}

test('Android 共享适配器在合成页面经 URL 传输读写，每个完成命令只点击一次', async t => {
  const { bridge, open } = setup(t, { realAdapter: true });
  const view = await open();
  const first = await bridge.execute({ type: 'read' });
  assert.equal(first.ok, true);
  const item = first.snapshot.items[1];
  const command = { type: 'setCompleted', pageId: first.snapshot.pageId, listId: item.listId,
    id: item.id, fingerprint: item.fingerprint, expectedCompleted: false, completed: true };
  const result = await bridge.execute(command);
  assert.equal(result.code, 'WEB_STATE_OBSERVED');
  assert.equal(result.cloudConfirmed, false);
  assert.equal(view.window.fixtureClicks, 1);
  assert.equal(view.scripts.length, 2);
  assert.equal(view.styles.plusrequire, 'none');
  const allowed = new RegExp(view.policy.match);
  assert.equal(allowed.test('https://idmsa.apple.com/appleauth/'), true);
  for (const url of ['http://www.icloud.com/', 'https://icloud.com.evil.test/', 'https://www.icloud.com:8443/', 'file:///test']) assert.equal(allowed.test(url), false);
});

test('Android 通过共用适配器保存标题、备注和旗标，每项只保存一次', async t => {
  const { bridge, open } = setup(t, { realAdapter: true });
  const view = await open();
  assert.equal(bridge.capabilities.editText, true);
  assert.equal(bridge.capabilities.editFlag, true);
  let { snapshot: current } = await bridge.execute({ type: 'read' });
  const itemId = current.items[1].id;
  const originalTitle = current.items[0].title;
  for (const [field, value] of [['title', '随行验证 · 修改标题'], ['notes', '随行验证 · 备注第一行\n第二行 <b>原文</b>'], ['flagged', true]]) {
    const item = current.items.find(candidate => candidate.id === itemId);
    const change = field === 'flagged'
      ? { type: 'setFlagged', flagged: value, expectedFlagged: item.flagged }
      : { type: 'setText', field, value };
    const command = { ...change, pageId: current.pageId, listId: item.listId, id: item.id, fingerprint: item.fingerprint, expectedCompleted: item.completed };
    const result = await bridge.execute(command);
    assert.equal(result.code, 'WEB_STATE_OBSERVED');
    assert.equal(result.cloudConfirmed, false);
    assert.equal(result.snapshot.items.find(candidate => candidate.id === itemId)[field], value);
    current = result.snapshot;
  }
  assert.equal(current.items[0].title, originalTitle);
  assert.equal(view.window.fixtureTextSaves, 2);
  assert.equal(view.window.fixtureFlagSaves, 1);
  assert.equal(view.window.fixtureClicks, 0);
  assert.equal(view.scripts.length, 4);
});

test('Android 在当前清单新增同名事项时只触发一次，拒绝重放原请求', async t => {
  const { bridge, open } = setup(t, { realAdapter: true });
  const view = await open();
  assert.equal(bridge.capabilities.openNewItem, true);
  assert.equal(bridge.capabilities.createItem, true);
  const { snapshot: before } = await bridge.execute({ type: 'read' });
  const command = { type: 'createItem', pageId: before.pageId, listId: before.activeListId,
    requestId: 'create-android-test', title: before.items[0].title };
  const result = await bridge.execute(command);
  assert.equal(result.code, 'WEB_STATE_OBSERVED');
  assert.equal(result.cloudConfirmed, false);
  const originalIds = new Set(before.items.map(item => item.id));
  const added = result.snapshot.items.filter(item => !originalIds.has(item.id));
  assert.equal(added.length, 1);
  assert.equal(added[0].title, command.title);
  assert.equal(result.snapshot.items.find(item => item.id === before.items[0].id).fingerprint, before.items[0].fingerprint);
  await bridge.execute({ type: 'read' });
  assert.equal((await bridge.execute(command)).code, 'ALREADY_SUBMITTED');
  assert.equal(view.window.fixtureCreationClicks, 1);
});

test('Android 未读取或新增参数有误时不派发，新增回执中断后要求核对', async t => {
  const state = setup(t);
  const view = await state.open();
  const command = { type: 'createItem', pageId: snapshot().pageId, listId: snapshot().activeListId,
    requestId: 'create-android-test', title: '随行验证 · 新增测试' };
  for (const patch of [{ title: ' ' }, { title: '甲\n乙' }, { requestId: '../test' }, { title: '验'.repeat(1001) }, { listId: '' }]) {
    assert.equal((await state.bridge.execute({ ...command, ...patch })).code, 'INVALID_COMMAND');
  }
  assert.equal((await state.bridge.execute(command)).code, 'READ_REQUIRED');
  assert.equal(view.scripts.length, 0);
  await state.read(view);
  const creating = state.bridge.execute(command);
  await tick();
  assert.equal((await state.bridge.reconnectSite()).code, 'BUSY');
  view.emit('loading');
  assert.equal((await creating).code, 'UNCERTAIN_WRITE');
  view.calls.at(-1).resolve(readResult());
  view.emit('loaded');
  await tick();
  assert.equal((await state.bridge.execute(command)).code, 'READ_REQUIRED');
  assert.equal(view.scripts.length, 2);
});

test('Android 设置全天、指定时间和清除日期时各保存一次，详情来源也遵循清除顺序', async t => {
  const { bridge, open } = setup(t, { realAdapter: true, timeoutMs: 5000 });
  const view = await open();
  assert.equal(bridge.capabilities.editSchedule, true);
  let { snapshot: current } = await bridge.execute({ type: 'read' });
  const id = current.items[1].id;
  const otherId = current.items[0].id;
  const zone = view.window.Intl.DateTimeFormat().resolvedOptions().timeZone;
  const empty = { date: null, time: null, timeZone: null };
  const allDay = { date: '2030-01-15', time: null, timeZone: null };
  const timed = { ...allDay, time: '14:35', timeZone: zone };
  const switches = [];
  let lastChange;
  for (const value of [allDay, timed, empty]) {
    if (value === empty) {
      view.window.fixtureScheduleOmitLoadedDate = true;
      view.window.renderFixture('one');
      ({ snapshot: current } = await bridge.execute({ type: 'read' }));
      view.window.document.addEventListener('click', event => {
        if (['editTime', 'atDate'].includes(event.target.id)) switches.push(event.target.id);
      }, true);
    }
    const item = current.items.find(candidate => candidate.id === id);
    const target = { pageId: current.pageId, listId: item.listId, id, fingerprint: item.fingerprint, expectedCompleted: item.completed };
    const before = await bridge.execute({ type: 'getSchedule', ...target });
    assert.equal(before.code, 'READY');
    if (value === empty) {
      assert.equal(before.scheduleSource, 'official-details');
      assert.deepEqual(before.schedule, timed);
    }
    lastChange = { type: 'setSchedule', ...target, expectedSchedule: before.schedule,
      expectedScheduleFingerprint: before.scheduleFingerprint, value };
    const result = await bridge.execute(lastChange);
    assert.equal(result.code, 'WEB_STATE_OBSERVED');
    assert.equal(result.cloudConfirmed, false);
    current = result.snapshot;
    assert.deepEqual(JSON.parse(view.window.sessionStorage.getItem('fixture-schedule-' + id)), value);
  }
  assert.deepEqual(switches, ['editTime', 'atDate']);
  assert.equal((await bridge.execute(lastChange)).code, 'STALE_VIEW');
  assert.equal(view.window.fixtureScheduleSaveClicks, 3);
  assert.equal(view.window.sessionStorage.getItem('fixture-schedule-' + otherId), null);
});

test('Android 日期命令校验真实日期和指纹，失去保存回执时要求重新读取', async t => {
  const state = setup(t);
  const view = await state.open();
  const empty = { date: null, time: null, timeZone: null };
  const read = { ...targetCommand, type: 'getSchedule' };
  const write = { ...targetCommand, type: 'setSchedule', expectedSchedule: empty,
    expectedScheduleFingerprint: 'synthetic-date', value: { ...empty, date: '2030-01-15' } };
  for (const patch of [{ expectedScheduleFingerprint: '' }, { value: { ...empty, date: '2030-02-29' } }, { expectedSchedule: { ...empty, time: '12:00' } }]) {
    assert.equal((await state.bridge.execute({ ...write, ...patch })).code, 'INVALID_COMMAND');
  }
  for (const command of [read, write]) assert.equal((await state.bridge.execute(command)).code, 'READ_REQUIRED');
  assert.equal(view.scripts.length, 0);
  await state.read(view);
  const saving = state.bridge.execute(write);
  await tick();
  view.calls.at(-1).reject(new Error('合成日期保存异常'));
  assert.equal((await saving).code, 'UNCERTAIN_WRITE');
  assert.equal((await state.bridge.execute(read)).code, 'READ_REQUIRED');
  assert.equal(view.scripts.length, 2);
});

test('Android 展开当前清单的已完成事项，重复查看不反转显示或修改事项', async t => {
  const { bridge, open } = setup(t, { realAdapter: true, timeoutMs: 5000 });
  const view = await open();
  assert.equal(bridge.capabilities.showCompleted, true);
  view.window.sessionStorage.setItem('fixture-complete', 'true');
  view.window.fixtureHideCompleted = true;
  view.window.renderFixture('one');
  const { snapshot: before } = await bridge.execute({ type: 'read' });
  assert.equal(before.items.length, 1);
  const command = { type: 'showCompleted', pageId: before.pageId, listId: before.activeListId };
  const result = await bridge.execute(command);
  assert.equal(result.code, 'VIEW_REQUESTED');
  assert.equal(result.snapshot.activeListId, before.activeListId);
  assert.equal(result.snapshot.items.filter(item => item.completed).length, 1);
  assert.match(result.snapshot.coverage, /已加载/);
  const again = await bridge.execute(command);
  assert.equal(again.snapshot.items.length, 2);
  assert.equal(view.window.fixtureCompletedActionClicks, 1);
  assert.equal(view.window.fixtureClicks, 0);
});

test('Android 已完成视图只接受当前清单的回执，并保留重新读取保护', async t => {
  const state = setup(t);
  const view = await state.open();
  const command = { type: 'showCompleted', pageId: snapshot().pageId, listId: snapshot().activeListId };
  assert.equal((await state.bridge.execute({ ...command, listId: '' })).code, 'INVALID_COMMAND');
  assert.equal((await state.bridge.execute(command)).code, 'READ_REQUIRED');
  assert.equal(view.scripts.length, 0);
  await state.read(view);
  const expanded = state.bridge.execute(command);
  await tick();
  view.calls.at(-1).resolve({ ...readResult(), snapshot: { ...snapshot(), activeListId: 'other-list' } });
  assert.equal((await expanded).code, 'STALE_VIEW');
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
  assert.equal(view.scripts.length, 2);
});

test('Android 拒绝不完整的文字和旗标命令，保留待核对前的写入保护', async t => {
  const { bridge, open } = setup(t);
  const view = await open();
  const note = { ...targetCommand, type: 'setText', field: 'notes', value: '' };
  const flag = { ...targetCommand, type: 'setFlagged', expectedFlagged: false, flagged: true };
  for (const command of [{ ...note, field: 'schedule' }, { ...note, value: '验'.repeat(2001) }, { ...note, field: 'title', value: '甲\n乙' }, { ...flag, expectedFlagged: 'false' }]) {
    assert.equal((await bridge.execute(command)).code, 'INVALID_COMMAND');
  }
  for (const command of [note, flag]) assert.equal((await bridge.execute(command)).code, 'READ_REQUIRED');
  assert.equal(view.scripts.length, 0);
});

test('Android 文字与旗标的异常、过大或清单错位回执一律要求重新核对', async t => {
  const state = setup(t);
  const view = await state.open();
  const note = { ...targetCommand, type: 'setText', field: 'notes', value: '随行验证' };
  const flag = { ...targetCommand, type: 'setFlagged', expectedFlagged: false, flagged: true };
  const attempts = [
    [note, call => call.reject(new Error('合成页面执行异常'))],
    [flag, call => call.resolve({ ...readResult(), snapshot: { ...snapshot(), items: [{ title: '验'.repeat(14000) }] } })],
    [note, call => call.resolve({ ...readResult(), snapshot: { ...snapshot(), activeListId: 'other-list' } })]
  ];
  for (const [command, reply] of attempts) {
    await state.read(view);
    const write = state.bridge.execute(command);
    await tick();
    reply(view.calls.at(-1));
    const result = await write;
    assert.equal(result.code, 'UNCERTAIN_WRITE');
    assert.equal(result.cloudConfirmed, false);
    assert.equal((await state.bridge.execute(command)).code, 'READ_REQUIRED');
  }
  assert.equal(view.scripts.length, 6);
});

test('写入期间切换区域、重载或另发命令都不关闭当前窗口', async t => {
  const state = setup(t);
  const view = await state.open();
  await state.read(view);
  const write = state.bridge.execute(writeCommand());
  await tick();
  assert.equal((await state.bridge.execute({ type: 'read' }, 'global')).code, 'BUSY');
  assert.equal((await state.bridge.openSite('global')).code, 'BUSY');
  assert.equal((await state.bridge.reloadSite()).code, 'BUSY');
  assert.equal((await state.bridge.reconnectSite()).code, 'BUSY');
  assert.equal((await state.bridge.openSite()).ok, true);
  assert.equal(state.views.length, 1);
  assert.equal(view.closed, 0);
  assert.equal(view.reloads, 0);
  assert.equal(view.loads.length, 1);
  view.calls.at(-1).resolve({ ...readResult(), code: 'WEB_STATE_OBSERVED', cloudConfirmed: true });
  assert.equal((await write).cloudConfirmed, false);
  assert.equal(view.scripts.length, 2);
});

for (const event of ['loading', 'error', 'close']) test(`Android ${event} 中断写入后拒绝重放，迟到回执不能解锁`, async t => {
  const state = setup(t);
  const view = await state.open();
  await state.read(view);
  const write = state.bridge.execute(writeCommand());
  await tick();
  const call = view.calls.at(-1);
  view.emit(event);
  const result = await write;
  assert.equal(result.code, 'UNCERTAIN_WRITE');
  assert.equal(result.cloudConfirmed, false);
  call.resolve(readResult());
  await tick();
  const active = event === 'close' ? await state.open() : view;
  active.emit('loaded');
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
  assert.equal(view.scripts.length, 2);
  await state.read(active);
  const next = state.bridge.execute(writeCommand());
  await tick();
  active.calls.at(-1).resolve(readResult());
  assert.equal((await next).ok, true);
});

test('读写超时后只允许重新读取，旧请求回执不影响新请求', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = setup(t, { timeoutMs: 15 });
  const view = await state.open();
  const read = state.bridge.execute({ type: 'read' });
  await tick();
  const lateRead = view.calls.at(-1);
  t.mock.timers.tick(15);
  assert.equal((await read).code, 'BRIDGE_TIMEOUT');
  await state.read(view);
  const write = state.bridge.execute(writeCommand());
  await tick();
  const lateWrite = view.calls.at(-1);
  t.mock.timers.tick(15);
  assert.equal((await write).code, 'UNCERTAIN_WRITE');
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
  const reread = state.bridge.execute({ type: 'read' });
  await tick();
  lateRead.resolve(readResult()); lateWrite.resolve(readResult());
  await tick();
  assert.equal((await state.bridge.execute(writeCommand())).code, 'BUSY');
  view.calls.at(-1).resolve(readResult());
  assert.equal((await reread).ok, true);
  assert.equal(view.scripts.length, 4);
});

test('切换区域后旧窗口的加载、关闭和返回按钮都不影响新窗口', async t => {
  const state = setup(t);
  const oldView = await state.open();
  const view = await state.open('global');
  for (const event of ['loading', 'loaded', 'error', 'close']) oldView.emit(event);
  oldView.styles.titleNView.buttons[0].onclick();
  assert.equal(oldView.closed, 1);
  assert.equal(view.hidden, 0);
  const read = state.bridge.execute({ type: 'read' }, 'global');
  await tick();
  view.calls.at(-1).resolve(readResult());
  assert.equal((await read).ok, true);
});

test('官方页面配置系统返回为隐藏，工具栏返回后继续复用原窗口和待处理回执', async t => {
  const state = setup(t);
  const view = await state.open();
  assert.equal(view.styles.backButtonAutoControl, 'hide');
  await state.read(view);
  const write = state.bridge.execute(writeCommand());
  await tick();
  view.styles.titleNView.buttons[0].onclick();
  assert.equal(view.hidden, 1);
  assert.equal(view.closed, 0);
  assert.equal((await state.bridge.openSite()).ok, true);
  assert.equal(state.views.length, 1);
  assert.equal(view.shown, 2);
  view.calls.at(-1).resolve(readResult());
  assert.equal((await write).ok, true);
  assert.equal(view.scripts.length, 2);
});

test('Android 重连复用窗口并仅恢复唯一的原清单，尚未加载时只读取指定清单', async t => {
  const state = setup(t);
  const view = await state.open();
  await state.read(view);
  const title = '随行验证 · 原清单';
  const connection = reconnectLoadedList(state.bridge, 'cn', { title, pageId: snapshot().pageId }, {
    wait: async () => view.emit('loaded'), attempts: 3
  });
  const listId = 'new-list';
  const pageId = 'new-page';
  const lists = [{ id: 'default-list', title: '随行验证 · 默认清单' }, { id: listId, title }];
  await tick();
  assert.deepEqual(view.loads, ['https://www.icloud.com.cn/reminders/', 'https://www.icloud.com.cn/reminders/']);
  assert.equal(view.closed, 0);
  assert.equal(state.views.length, 1);
  assert.equal(view.calls.at(-1).command.type, 'readLists');
  view.calls.at(-1).resolve({ ...readResult(), snapshot: { ...snapshot(), pageId, activeListId: null, lists } });
  await tick();
  assert.equal(view.calls.at(-1).command.type, 'selectList');
  assert.equal(view.calls.at(-1).command.listId, listId);
  view.calls.at(-1).resolve({ ok: false, code: 'LIST_LOADING' });
  await tick();
  const read = view.calls.at(-1);
  assert.equal(read.command.type, 'readList');
  assert.equal(read.command.pageId, pageId);
  assert.equal(read.command.listId, listId);
  read.resolve({ ...readResult(), snapshot: { ...snapshot(), pageId, activeListId: listId, activeListTitle: title, lists } });
  assert.equal((await connection).code, 'RECONNECTED');
  assert.deepEqual(view.calls.map(call => call.command.type), ['read', 'readLists', 'selectList', 'readList']);
});

test('Android 导航回执不授权写入，实际共享适配器只在指定清单就绪后返回事项', async t => {
  const state = setup(t, { realAdapter: true });
  const view = await state.open();
  const navigation = await state.bridge.execute({ type: 'readLists' });
  assert.equal(navigation.ok, true);
  assert.equal(navigation.snapshot.activeListId, null);
  assert.equal(navigation.snapshot.items.length, 0);
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
  const { pageId, lists } = navigation.snapshot;
  const listId = lists[1].id;
  assert.equal((await state.bridge.execute({ type: 'readList', pageId, listId })).code, 'STALE_VIEW');
  const selected = await state.bridge.execute({ type: 'selectList', pageId, listId });
  assert.equal(selected.snapshot.activeListId, listId);
  assert.equal(selected.snapshot.items.length, 1);
  const loaded = await state.bridge.execute({ type: 'readList', pageId, listId });
  assert.equal(loaded.snapshot.activeListId, listId);
  assert.equal(view.window.fixtureClicks, 0);
});

test('Android 拒绝使用选错清单的回执恢复写入权限', async t => {
  const state = setup(t);
  const view = await state.open();
  for (const type of ['selectList', 'readList']) {
    const result = state.bridge.execute({ type, pageId: snapshot().pageId, listId: 'other-list' });
    await tick();
    view.calls.at(-1).resolve(readResult());
    assert.equal((await result).code, 'STALE_VIEW');
    assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
  }
  assert.equal(view.calls.length, 2);
});

test('Android 断网时中断写入，网络恢复及旧回执都不能解除重新读取要求', async t => {
  let type = 0;
  const state = setup(t, { networkinfo: { CONNECTION_NONE: 1, getCurrentType: () => type } });
  const view = await state.open();
  await state.read(view);
  assert.equal(state.bridge.connectionState().state, 'unknown');
  const write = state.bridge.execute(writeCommand());
  await tick();
  const oldCall = view.calls.at(-1);
  type = 1;
  assert.equal(state.bridge.connectionState().state, 'offline');
  assert.equal((await write).code, 'UNCERTAIN_WRITE');
  type = 3;
  assert.equal(state.bridge.connectionState().state, 'available');
  oldCall.resolve(readResult());
  await tick();
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
  assert.equal(view.scripts.length, 2);
});

test('关闭连接即结束待处理写入，之后不能重新创建窗口', async t => {
  const state = setup(t);
  const view = await state.open();
  await state.read(view);
  const write = state.bridge.execute(writeCommand());
  await tick();
  state.bridge.dispose();
  assert.equal((await write).code, 'UNCERTAIN_WRITE');
  assert.equal((await state.bridge.openSite()).code, 'CLOSED');
  assert.equal((await state.bridge.reloadSite()).code, 'CLOSED');
  assert.equal((await state.bridge.execute({ type: 'read' })).code, 'CLOSED');
  assert.equal(view.closed, 1);
  assert.equal(state.views.length, 1);
});

test('同步执行异常及异步拒绝不泄漏异常，并将写入标为未知', async t => {
  const state = setup(t);
  const view = await state.open();
  await state.read(view);
  view.throwOnEval = true;
  assert.equal((await state.bridge.execute(writeCommand())).code, 'UNCERTAIN_WRITE');
  view.throwOnEval = false;
  await state.read(view);
  const write = state.bridge.execute(writeCommand());
  await tick();
  view.calls.at(-1).reject(new Error('合成私有异常，不应返回'));
  const result = await write;
  assert.equal(result.code, 'UNCERTAIN_WRITE');
  assert.doesNotMatch(JSON.stringify(result), /私有异常/);
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
});

test('Android 拒绝任意命令、原型区域和未读取页面的写入', async t => {
  const state = setup(t);
  assert.equal((await state.bridge.openSite('__proto__')).code, 'INVALID_REGION');
  assert.equal((await state.bridge.execute({ type: 'eval', script: '任意代码' })).code, 'INVALID_COMMAND');
  assert.equal((await state.bridge.execute({ ...writeCommand(), completed: 'true' })).code, 'INVALID_COMMAND');
  assert.equal(state.views.length, 0);
  const view = await state.open();
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
  view.url = 'https://icloud.com.evil.test/';
  view.emit('loaded');
  assert.equal((await state.bridge.execute({ type: 'read' })).code, 'PAGE_NOT_READY');
  assert.equal(view.scripts.length, 0);
});

test('按编码后的 URL 限制中文快照大小，超限不拆分重发', async t => {
  const state = setup(t);
  const view = await state.open();
  const read = state.bridge.execute({ type: 'read' });
  await tick();
  view.calls.at(-1).resolve({ ...readResult(), snapshot: { ...snapshot(), items: [{ title: '验'.repeat(14000) }] } });
  assert.equal((await read).code, 'PAYLOAD_TOO_LARGE');
  assert.equal(view.scripts.length, 1);
  assert.ok(view.replies[0].length < 110000);
});

test('不完整或不可解码回执立即失败，写入必须先读取再继续', async t => {
  const state = setup(t);
  const view = await state.open();
  await state.read(view);
  const write = state.bridge.execute(writeCommand());
  await tick();
  view.calls.at(-1).resolve({ ok: true, code: 'READY', snapshot: {} });
  assert.equal((await write).code, 'UNCERTAIN_WRITE');
  const read = state.bridge.execute({ type: 'read' });
  await tick();
  view.receive({ url: 'suixingbridge://reply?payload=%invalid' });
  assert.equal((await read).code, 'INVALID_REPLY');
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
});

test('窗口配置失败后释放半成品，下次打开可以正常重新创建', async t => {
  const state = setup(t, { failFirstSetup: true });
  assert.equal((await state.bridge.openSite()).code, 'BRIDGE_ERROR');
  assert.equal(state.views[0].closed, 1);
  const view = await state.open();
  assert.equal(state.views.length, 2);
  assert.equal((await state.read(view)).ok, true);
});
