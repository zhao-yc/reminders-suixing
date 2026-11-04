import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createAndroidBridge } from '../apps/uni-app/lib/android-bridge.js';

const source = await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js', import.meta.url), 'utf8');
const fixture = await fs.readFile(new URL('./fixtures/reminders.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = () => ({ pageId: 'synthetic-page', activeListId: 'synthetic-list', lists: [], items: [] });
const readResult = () => ({ ok: true, code: 'READY', snapshot: snapshot() });
const writeCommand = () => ({ type: 'setCompleted', pageId: 'synthetic-page', listId: 'synthetic-list',
  id: 'synthetic-item', fingerprint: 'synthetic-fingerprint', expectedCompleted: false, completed: true });

/** 只替代原生传输；注入脚本确实执行，并通过拦截的 URL 回到同一窗口。 */
function setup(t, options = {}) {
  const views = [];
  const runtime = { webview: { create(url, id, styles) {
    const listeners = new Map();
    const view = {
      id, styles, scripts: [], calls: [], replies: [], closed: 0, shown: 0, hidden: 0, reloads: 0,
      emit(event) { for (const listener of listeners.get(event) || []) listener(); },
      addEventListener(event, callback) { listeners.set(event, [...(listeners.get(event) || []), callback]); },
      overrideUrlLoading(policy, callback) {
        if (options.failFirstSetup && views.length === 1) throw new Error('合成窗口配置失败');
        this.policy = policy; this.receive = callback;
      },
      getURL() { return this.url; },
      loadURL(value) { this.url = value; this.emit('loading'); },
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

test('写入期间切换区域、重载或另发命令都不关闭当前窗口', async t => {
  const state = setup(t);
  const view = await state.open();
  await state.read(view);
  const write = state.bridge.execute(writeCommand());
  await tick();
  assert.equal((await state.bridge.execute({ type: 'read' }, 'global')).code, 'BUSY');
  assert.equal((await state.bridge.openSite('global')).code, 'BUSY');
  assert.equal((await state.bridge.reloadSite()).code, 'BUSY');
  assert.equal((await state.bridge.openSite()).ok, true);
  assert.equal(state.views.length, 1);
  assert.equal(view.closed, 0);
  assert.equal(view.reloads, 0);
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
  const state = setup(t, { timeoutMs: 15 });
  const view = await state.open();
  assert.equal((await state.bridge.execute({ type: 'read' })).code, 'BRIDGE_TIMEOUT');
  const lateRead = view.calls.at(-1);
  await state.read(view);
  const write = state.bridge.execute(writeCommand());
  await tick();
  const lateWrite = view.calls.at(-1);
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
