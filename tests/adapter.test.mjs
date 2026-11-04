import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { isApplePage } from '../apps/uni-app/lib/origins.js';

const source = await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js', import.meta.url), 'utf8');
const fixture = await fs.readFile(new URL('./fixtures/reminders.html', import.meta.url), 'utf8');

function setup(t, html = fixture) {
  const dom = new JSDOM(html, { url: 'https://www.icloud.com.cn/reminders/', runScripts: 'dangerously' });
  dom.window.eval(source);
  t.after(() => dom.window.close());
  return { window: dom.window, execute: command => dom.window.__suixingAdapter.execute(command) };
}

function completion(snapshot, index = 0) {
  const item = snapshot.items[index];
  return { type: 'setCompleted', pageId: snapshot.pageId, listId: item.listId,
    id: item.id, fingerprint: item.fingerprint, expectedCompleted: item.completed, completed: !item.completed };
}

test('域名检查兼容中国区并拒绝相似域名、HTTP 和非标准端口', () => {
  for (const url of ['https://www.icloud.com.cn/reminders/', 'https://idmsa.apple.com/appleauth/']) assert.equal(isApplePage(url), true);
  for (const url of ['https://icloud.com.evil.example/', 'https://evilicloud.com/', 'http://www.icloud.com/', 'https://www.icloud.com:8443/']) assert.equal(isApplePage(url), false);
});

test('读取保留同名事项的不同记录 ID，且不重复辅助文字', async t => {
  const { execute } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  assert.equal(snapshot.items.length, 2);
  assert.notEqual(snapshot.items[0].id, snapshot.items[1].id);
  assert.equal(snapshot.items[0].title, snapshot.items[1].title);
  assert.equal(snapshot.items[0].metadata, '2026/11/04');
  assert.equal(snapshot.partial, false);
});

test('未登录页面不产生虚假的已连接清单', async t => {
  const { execute } = setup(t, '<h1>登录 iCloud</h1><input type="password">');
  const result = await execute({ type: 'read' });
  assert.equal(result.code, 'PAGE_NOT_READY');
  assert.equal(result.snapshot, undefined);
});

test('列表加载中不把尚未取得的数据报告为空清单', async t => {
  const { execute, window } = setup(t);
  const loading = window.document.createElement('div');
  loading.setAttribute('role', 'progressbar');
  window.document.body.append(loading);
  assert.equal((await execute({ type: 'read' })).code, 'LIST_LOADING');
});

test('重复清单名称用页面句柄区分，而不是按名称选择', async t => {
  const { execute } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  assert.notEqual(snapshot.lists[0].id, snapshot.lists[1].id);
  const selected = await execute({ type: 'selectList', pageId: snapshot.pageId, listId: snapshot.lists[1].id });
  assert.equal(selected.ok, true);
  assert.equal(selected.snapshot.items.length, 1);
  assert.equal(selected.snapshot.items[0].title, '随行验证 · 第二个同名清单');
});

test('完成只点击目标记录一次，网页回执不冒充云端保存确认', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  const result = await execute(completion(snapshot, 1));
  assert.equal(result.code, 'WEB_STATE_OBSERVED');
  assert.equal(result.cloudConfirmed, false);
  assert.equal(window.fixtureClicks, 1);
  assert.equal(result.snapshot.items[0].completed, false);
  assert.equal(result.snapshot.items[1].completed, true);
});

test('页面内容在读取后变化时拒绝旧写入', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  window.document.querySelector('.title [role="textbox"]').textContent = '其他设备修改了标题';
  const result = await execute(completion(snapshot));
  assert.equal(result.code, 'STALE_VIEW');
  assert.equal(window.fixtureClicks, 0);
});

test('使用完整指针交互，兼容不响应单独 click() 的真实网页控件', async t => {
  const { execute, window } = setup(t);
  window.fixtureRequiresPointerDown = true;
  window.document.querySelector('.mark-completed').click();
  assert.equal(window.fixtureClicks, 0);
  const { snapshot } = await execute({ type: 'read' });
  assert.equal((await execute(completion(snapshot))).code, 'WEB_STATE_OBSERVED');
  assert.equal(window.fixtureClicks, 1);
});

test('旧页面句柄和错误清单均不能写入', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  assert.equal((await execute({ ...completion(snapshot), pageId: '旧会话' })).code, 'STALE_VIEW');
  assert.equal((await execute({ ...completion(snapshot), listId: '其他清单' })).code, 'STALE_VIEW');
  assert.equal(window.fixtureClicks, 0);
});

test('只读事项和非布尔状态被明确拒绝', async t => {
  const { execute, window } = setup(t);
  window.document.querySelector('.mark-completed').setAttribute('aria-disabled', 'true');
  const { snapshot } = await execute({ type: 'read' });
  assert.equal((await execute(completion(snapshot))).code, 'READ_ONLY');
  assert.equal((await execute({ ...completion(snapshot), completed: 'true' })).code, 'INVALID_COMMAND');
  assert.equal(window.fixtureClicks, 0);
});

test('目标状态已满足时不再次点击', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  const result = await execute({ ...completion(snapshot), completed: false });
  assert.equal(result.code, 'UNCHANGED');
  assert.equal(window.fixtureClicks, 0);
});

test('加载数量小于页面标示数量时明确返回部分数据', async t => {
  const { execute, window } = setup(t);
  window.document.querySelector('.reminder-item').setAttribute('aria-setsize', '80');
  assert.equal((await execute({ type: 'read' })).snapshot.partial, true);
});

test('写入没有回执时不重试，且后续旧写入必须先刷新', async t => {
  const { execute, window } = setup(t);
  window.fixtureDisableUpdates = true;
  const { snapshot } = await execute({ type: 'read' });
  const result = await execute(completion(snapshot));
  assert.equal(result.code, 'UNCERTAIN_WRITE');
  assert.equal(window.fixtureClicks, 1);
  assert.equal((await execute(completion(snapshot))).code, 'STALE_VIEW');
  assert.equal(window.fixtureClicks, 1);
});
