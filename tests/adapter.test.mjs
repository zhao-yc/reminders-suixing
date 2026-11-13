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

function textChange(snapshot, field, value, index = 0) {
  const item = snapshot.items[index];
  return { type: 'setText', pageId: snapshot.pageId, listId: item.listId, id: item.id,
    fingerprint: item.fingerprint, expectedCompleted: item.completed, field, value };
}

test('标题编辑只命中同名事项中的目标，HTML 作为文字且只保存一次', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  const value = '<b>随行验证 · 改名</b>';
  const result = await execute(textChange(snapshot, 'title', value, 1));
  assert.equal(result.code, 'WEB_STATE_OBSERVED');
  assert.equal(result.cloudConfirmed, false);
  assert.equal(result.snapshot.items[0].title, snapshot.items[0].title);
  assert.equal(result.snapshot.items[1].title, value);
  assert.equal(window.document.querySelector('.title b'), null);
  assert.equal(window.fixtureTextSaves, 1);
  assert.equal(window.fixtureClicks, 0);
});

test('备注支持换行与清空，每个明确修改各提交一次', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  const value = '随行验证 · 第一行\n第二行';
  const first = await execute(textChange(snapshot, 'notes', value));
  assert.equal(first.snapshot.items[0].notes, value);
  const second = await execute(textChange(first.snapshot, 'notes', ''));
  assert.equal(second.snapshot.items[0].notes, '');
  assert.equal(window.fixtureTextSaves, 2);
  assert.equal(window.fixtureTextPreparations, 2);
  assert.equal(window.fixtureTextInputs, 2);
});

test('多行原生输入先准备完整范围，HTML 字符和连续空行作为纯文字保存', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  const value = '随行验证 · <img src=x onerror="x"> & 第一行\n\n第二行';
  let nativeCalls = 0;
  const insert = window.document.execCommand;
  window.document.execCommand = (...args) => { nativeCalls++; return insert(...args); };
  const result = await execute(textChange(snapshot, 'notes', value));
  assert.equal(result.snapshot.items[0].notes, value);
  assert.equal(window.document.querySelector('.notes img'), null);
  assert.equal(window.fixtureTextPreparations, 1);
  assert.equal(window.fixtureTextInputs, 1);
  assert.equal(window.fixtureTextSaves, 1);
  assert.equal(nativeCalls, 1);
});

test('网页取消输入时不再执行原生文字命令，也不把接管当成没有写入', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  window.document.querySelector('.notes [role="textbox"]').addEventListener('beforeinput', event => event.preventDefault());
  window.document.execCommand = () => { throw Error('不应执行'); };
  const result = await execute(textChange(snapshot, 'notes', '随行验证 · 网页接管'));
  assert.equal(result.code, 'UNCERTAIN_WRITE');
  assert.equal(window.fixtureTextSaves, 0);
  assert.equal((await execute(textChange(snapshot, 'notes', '随行验证 · 禁止重放'))).code, 'STALE_VIEW');
});

test('截断显示的长备注不得用局部内容覆盖原备注', async t => {
  const { execute, window } = setup(t);
  const note = window.document.querySelector('.notes [role="textbox"]');
  const original = '随行验证' + '长'.repeat(2000);
  note.textContent = original;
  const { snapshot } = await execute({ type: 'read' });
  assert.equal(snapshot.items[0].notesTruncated, true);
  assert.equal(snapshot.items[0].notes.length, 2000);
  assert.equal((await execute(textChange(snapshot, 'notes', '不能覆盖'))).code, 'READ_ONLY');
  assert.equal(window.fixtureTextInputs, 0);
  assert.equal(note.textContent, original);
});

test('浏览器生成的备注分段和空行在读回时保留', async t => {
  const { execute, window } = setup(t);
  const editor = window.document.querySelector('.notes [role="textbox"]');
  for (const [html, expected] of [
    ['第一行<div>第二行</div>', '第一行\n第二行'],
    ['<div>第一行</div><div><br></div><div>第二行</div>', '第一行\n\n第二行'],
    ['第一行<br>第二行', '第一行\n第二行']
  ]) {
    editor.innerHTML = html;
    assert.equal((await execute({ type: 'read' })).snapshot.items[0].notes, expected);
  }
});

test('隐藏容器缺少离开编辑事件时补齐提交，迟到原生失焦不重复保存', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  const editor = window.document.querySelector('.title [role="textbox"]');
  const nativeBlur = editor.blur.bind(editor);
  let fallbackEvent;
  editor.addEventListener('focusout', event => { fallbackEvent = event; });
  editor.blur = () => {};
  const result = await execute(textChange(snapshot, 'title', '随行验证 · 隐藏编辑'));
  assert.equal(result.code, 'WEB_STATE_OBSERVED');
  assert.equal(window.fixtureTextSaves, 1);
  assert.equal(fallbackEvent.view, window);
  assert.equal(fallbackEvent.relatedTarget, window.document.body);
  nativeBlur();
  assert.equal(window.fixtureTextSaves, 1);
});

test('标题或其他字段已变化时拒绝旧编辑，不能覆盖新内容', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  window.document.querySelector('.title [role="textbox"]').textContent = '随行验证 · 其他端已改';
  assert.equal((await execute(textChange(snapshot, 'notes', '不应写入'))).code, 'STALE_VIEW');
  assert.equal(window.fixtureTextSaves, 0);
});

test('进入原生编辑状态时发生内容变化，也必须拒绝旧编辑', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  window.document.querySelector('.reminder-item').addEventListener('click', () => {
    window.document.querySelector('.notes [role="textbox"]').textContent = '随行验证 · 进入编辑时变更';
  });
  assert.equal((await execute(textChange(snapshot, 'title', '随行验证 · 不应覆盖'))).code, 'STALE_VIEW');
  assert.equal(window.fixtureTextSaves, 0);
});

test('备注先通过字段容器进入编辑状态，再提交原生文字命令', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  const container = window.document.querySelector('.notes');
  let editing = false;
  container.addEventListener('mousedown', event => { if (event.target === container) editing = true; });
  const nativeInsert = window.document.execCommand;
  window.document.execCommand = (...args) => { assert.equal(editing, true); return nativeInsert(...args); };
  assert.equal((await execute(textChange(snapshot, 'notes', '随行验证 · 备注编辑'))).code, 'WEB_STATE_OBSERVED');
  assert.equal(window.fixtureTextSaves, 1);
});

test('不完整、只读和不支持的编辑不会触发文字写入', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  for (const [field, value] of [['title', ''], ['title', 'a\nb'], ['notes', 'a'.repeat(2001)], ['innerHTML', 'x']]) {
    assert.equal((await execute(textChange(snapshot, field, value))).code, 'INVALID_COMMAND');
  }
  window.document.querySelector('.title [role="textbox"]').setAttribute('contenteditable', 'false');
  assert.equal((await execute(textChange(snapshot, 'title', '随行验证 · 新标题'))).code, 'READ_ONLY');
  window.document.execCommand = undefined;
  assert.equal((await execute(textChange(snapshot, 'notes', '随行验证 · 备注'))).code, 'EDIT_UNAVAILABLE');
  assert.equal(window.fixtureTextSaves, 0);
});

test('编辑命令异常后不回退或重放，旧编辑必须先重新读取', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  let calls = 0;
  window.document.execCommand = () => { calls++; throw new Error('合成异常详情'); };
  const command = textChange(snapshot, 'title', '随行验证 · 异常编辑');
  const result = await execute(command);
  assert.equal(result.code, 'UNCERTAIN_WRITE');
  assert.doesNotMatch(JSON.stringify(result), /合成异常详情/);
  assert.equal((await execute(command)).code, 'STALE_VIEW');
  assert.equal(calls, 1);
});

test('文字未变化时不进入编辑或再次保存', async t => {
  const { execute, window } = setup(t);
  const { snapshot } = await execute({ type: 'read' });
  assert.equal((await execute(textChange(snapshot, 'title', snapshot.items[0].title))).code, 'UNCHANGED');
  assert.equal(window.fixtureTextSaves, 0);
});

test('域名检查兼容中国区并拒绝相似域名、HTTP 和非标准端口', () => {
  for (const url of ['https://www.icloud.com.cn/reminders/', 'https://idmsa.apple.com/appleauth/', 'HTTPS://WWW.ICLOUD.COM:443/?test']) assert.equal(isApplePage(url), true);
  for (const url of ['https://icloud.com.evil.example/', 'https://evilicloud.com/', 'http://www.icloud.com/', 'https://www.icloud.com:8443/',
    'https://www.icloud.com@evil.example/', 'https://evil.example@www.icloud.com/', 'https://www.icloud.com\\@evil.example/']) assert.equal(isApplePage(url), false);
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
