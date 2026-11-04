import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { clickTestCompletion } = require('../apps/desktop/verification-ui.cjs');
const { testOperation, summarize } = require('../apps/desktop/live-check.cjs');

for (const tag of ['button', 'uni-button']) {
  for (const completed of [false, true]) {
    test(`${tag} 的${completed ? '取消完成' : '完成'}验收切换页签并且只点击目标一次`, async t => {
      const dom = new JSDOM(`<div class="list-content" data-page-id="page-test" data-list-id="list-test">
        <div class="tabs"><${tag} data-status="pending" class="${completed ? 'active' : ''}"></${tag}><${tag} data-status="completed" class="${completed ? '' : 'active'}"></${tag}></div>
        <div class="rows"></div></div>`, { runScripts: 'outside-only' });
      t.after(() => dom.window.close());
      const { document } = dom.window;
      let clicks = 0;
      let tabs = 0;
      document.querySelectorAll('.tabs > *').forEach(tab => tab.addEventListener('click', () => {
        tabs++;
        document.querySelectorAll('.tabs > *').forEach(other => other.classList.toggle('active', other === tab));
        document.querySelector('.rows').innerHTML = `<div class="reminder-row" data-record-id="other"><${tag} class="completion-button"></${tag}></div><div class="reminder-row" data-record-id="record-test"><${tag} class="completion-button ${completed ? 'checked' : ''}"></${tag}></div>`;
        document.querySelector('[data-record-id="other"] .completion-button').addEventListener('click', () => assert.fail('不能点击其他记录'));
        document.querySelector('[data-record-id="record-test"] .completion-button').addEventListener('click', () => { clicks++; });
      }));
      const expected = { pageId: 'page-test', listId: 'list-test', id: 'record-test', completed };
      assert.equal(await dom.window.eval(`(${clickTestCompletion})(${JSON.stringify(expected)})`), true);
      assert.equal(tabs, 1);
      assert.equal(clicks, 1);
    });
  }
}

test('旧页面和禁用按钮不会被开发验收入口点击', async t => {
  const dom = new JSDOM('<div class="list-content" data-page-id="new-page" data-list-id="list-test"><div class="tabs"><uni-button data-status="pending" class="active"></uni-button></div><div class="reminder-row" data-record-id="record-test"><uni-button disabled="true" class="completion-button"></uni-button></div></div>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.setTimeout = callback => setTimeout(callback, 0);
  let clicks = 0;
  dom.window.document.querySelector('.completion-button').addEventListener('click', () => clicks++);
  for (const pageId of ['old-page', 'new-page']) {
    assert.equal(await dom.window.eval(`(${clickTestCompletion})(${JSON.stringify({ pageId, listId: 'list-test', id: 'record-test', completed: false })})`), false);
  }
  assert.equal(clicks, 0);
});

function scopedController(completed, listTitle = '随行验证 · 合成清单') {
  const snapshot = { pageId: 'test-page', activeListId: 'test-list', activeListTitle: listTitle,
    lists: [{ id: 'test-list', title: listTitle }], items: [{ id: 'test-item', listId: 'test-list', title: '随行验证 · 最小读写验证', completed }] };
  return { execute: async command => { assert.equal(command.type, 'read'); return { ok: true, snapshot }; } };
}

test('测试事项已经达到目标状态时，不触发界面和写入', async () => {
  const result = await testOperation(scopedController(false), 'uncomplete-test-item', {
    sendSnapshot: () => assert.fail('只读核对不应更新界面'), ui: null
  });
  assert.equal(result.code, 'UNCHANGED');
  assert.equal(result.dispatched, false);
  assert.equal(summarize(result).testCompleted, false);
});

test('自动验证拒绝普通清单，不向界面派发事项写入', async () => {
  const result = await testOperation(scopedController(false, '普通合成清单'), 'complete-test-item', { ui: null });
  assert.equal(result.code, 'TEST_LIST_NOT_UNIQUE');
});

test('界面执行中断返回不确定状态，不宣称没有点击', async () => {
  let invocations = 0;
  const result = await testOperation(scopedController(false), 'complete-test-item', {
    sendSnapshot() {}, ui: { webContents: { async executeJavaScript() { invocations++; throw new Error('合成渲染器中断'); } } }
  });
  assert.equal(result.code, 'UNCERTAIN_WRITE');
  assert.equal(result.cloudConfirmed, false);
  assert.equal(result.dispatched, undefined);
  assert.equal(invocations, 1);
});
