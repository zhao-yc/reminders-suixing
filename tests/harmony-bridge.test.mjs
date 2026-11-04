import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createHarmonyBridge } from '../apps/uni-app/lib/harmony-bridge.js';
import { REPLY_PREFIX } from '../apps/uni-app/lib/native-protocol.js';

const source = await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js', import.meta.url), 'utf8');
const fixture = await fs.readFile(new URL('./fixtures/reminders.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = () => ({ pageId: 'synthetic-page', lists: [], items: [] });
const readyResult = () => ({ ok: true, code: 'READY', snapshot: snapshot() });
const writeCommand = () => ({ type: 'setCompleted', pageId: 'synthetic-page', listId: 'synthetic-list',
  id: 'synthetic-item', fingerprint: 'synthetic-fingerprint', expectedCompleted: false, completed: true });

/** 模拟原生组件的消息传输，不模拟鸿蒙运行或官方认证。 */
function setup(t, options = {}) {
  let state;
  const calls = [];
  const environments = new Map();
  const bridge = createHarmonyBridge({ adapterSource: options.realAdapter ? source : '', timeoutMs: options.timeoutMs || 1000 });
  bridge.onHostState(value => { state = value; });
  t.after(() => bridge.dispose());
  t.after(() => { for (const environment of environments.values()) environment.window.close?.(); });
  return { bridge, calls, get state() { return state; },
    event(type, values = {}, instanceId = state.instanceId) { bridge.handleHostEvent({ instanceId, type, official: true, ...values }); },
    async open(region = 'cn') { assert.equal((await bridge.openSite(region)).ok, true); this.event('loaded'); },
    packet() { return JSON.parse(state.packet); },
    dispatch(packet = this.packet()) {
      const instanceId = state.instanceId;
      if (!environments.has(instanceId)) {
        const window = options.realAdapter
          ? new JSDOM(fixture, { url: 'https://www.icloud.com.cn/reminders/', runScripts: 'dangerously' }).window
          : { __suixingAdapter: { execute(command) { return new Promise((resolve, reject) => calls.push({ command, resolve, reject })); } } };
        const location = { set href(value) {
          bridge.handleHostEvent({ instanceId, type: 'reply', official: true, payload: value.slice(REPLY_PREFIX.length) });
        } };
        environments.set(instanceId, vm.createContext({ window, location, setTimeout, clearTimeout }));
      }
      const environment = environments.get(instanceId);
      vm.runInContext(packet.source, environment);
      return environment.window;
    },
    async read() {
      const read = bridge.execute({ type: 'read' });
      this.dispatch();
      await tick();
      calls.at(-1).resolve(readyResult());
      return read;
    }
  };
}

test('鸿蒙逻辑层在合成页面执行唯一共享适配器并只派发一次完成操作', async t => {
  const state = setup(t, { realAdapter: true });
  await state.open();
  const read = state.bridge.execute({ type: 'read' });
  const window = state.dispatch();
  const { snapshot } = await read;
  const item = snapshot.items[0];
  const write = state.bridge.execute({ type: 'setCompleted', pageId: snapshot.pageId, listId: item.listId,
    id: item.id, fingerprint: item.fingerprint, expectedCompleted: false, completed: true });
  assert.equal(state.dispatch(), window);
  const result = await write;
  assert.equal(result.code, 'WEB_STATE_OBSERVED');
  assert.equal(result.cloudConfirmed, false);
  assert.equal(window.fixtureClicks, 1);
});

test('鸿蒙回执正常返回时不把网页状态提升为云端保存确认', async t => {
  const state = setup(t);
  await state.open();
  await state.read();
  const write = state.bridge.execute(writeCommand());
  state.dispatch();
  await tick();
  assert.equal(state.calls.at(-1).command.type, 'setCompleted');
  state.calls.at(-1).resolve({ ...readyResult(), code: 'WEB_STATE_OBSERVED', cloudConfirmed: true });
  assert.equal((await write).cloudConfirmed, false);
  assert.equal(state.calls.length, 2);
});

test('未挂载、非官方页面、未刷新时不执行鸿蒙写入', async t => {
  const state = setup(t);
  assert.equal((await state.bridge.execute({ type: 'read' })).code, 'PAGE_NOT_READY');
  assert.equal((await state.bridge.openSite('__proto__')).code, 'INVALID_REGION');
  assert.equal((await state.bridge.execute({ type: 'eval' })).code, 'INVALID_COMMAND');
  await state.open();
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
  state.event('loaded', { official: false });
  assert.equal((await state.bridge.execute({ type: 'read' })).code, 'PAGE_NOT_READY');
});

test('鸿蒙隐藏官方页面保持同一实例，忙碌时不能换区或重载', async t => {
  const state = setup(t);
  await state.open();
  const instanceId = state.state.instanceId;
  await state.read();
  const write = state.bridge.execute(writeCommand());
  state.dispatch();
  await tick();
  assert.equal(state.bridge.hideSite(), true);
  assert.equal(state.bridge.hideSite(), false);
  assert.equal(state.state.visible, false);
  assert.equal(state.state.instanceId, instanceId);
  assert.equal((await state.bridge.openSite('global')).code, 'BUSY');
  assert.equal((await state.bridge.reloadSite()).code, 'BUSY');
  assert.equal((await state.bridge.openSite()).ok, true);
  assert.equal(state.state.instanceId, instanceId);
  state.calls.at(-1).resolve(readyResult());
  assert.equal((await write).ok, true);
});

for (const type of ['loading', 'error', 'closed']) test(`鸿蒙 ${type} 中断写入后，迟到回执不能解除读取要求`, async t => {
  const state = setup(t);
  await state.open();
  await state.read();
  const write = state.bridge.execute(writeCommand());
  state.dispatch();
  await tick();
  const late = state.calls.at(-1);
  state.event(type);
  assert.equal((await write).code, 'UNCERTAIN_WRITE');
  late.resolve(readyResult());
  await tick();
  if (type === 'closed') await state.open();
  else state.event('loaded');
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
  await state.read();
});

test('旧鸿蒙实例事件与旧请求回执不能完成当前请求', async t => {
  const state = setup(t);
  await state.open();
  const oldInstance = state.state.instanceId;
  await state.open('global');
  state.event('error', {}, oldInstance);
  const read = state.bridge.execute({ type: 'read' }, 'global');
  const packet = state.packet();
  state.event('reply', { payload: encodeURIComponent(JSON.stringify({ requestId: packet.id, result: readyResult() })) }, oldInstance);
  state.event('reply', { payload: encodeURIComponent(JSON.stringify({ requestId: 'old-request', result: readyResult() })) });
  assert.equal((await state.bridge.execute({ type: 'read' }, 'global')).code, 'BUSY');
  state.event('reply', { payload: encodeURIComponent(JSON.stringify({ requestId: packet.id, result: readyResult() })) });
  assert.equal((await read).ok, true);
});

test('鸿蒙超时和破损回执要求先读，关闭后不能重建连接', async t => {
  const state = setup(t, { timeoutMs: 15 });
  await state.open();
  assert.equal((await state.bridge.execute({ type: 'read' })).code, 'BRIDGE_TIMEOUT');
  await state.read();
  const write = state.bridge.execute(writeCommand());
  state.event('reply', { payload: '%invalid' });
  assert.equal((await write).code, 'UNCERTAIN_WRITE');
  assert.equal((await state.bridge.execute(writeCommand())).code, 'READ_REQUIRED');
  state.bridge.dispose();
  assert.equal(state.state, null);
  assert.equal((await state.bridge.openSite()).code, 'CLOSED');
});
