import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import diagnostics from '../apps/desktop/editor-diagnostics.cjs';

function page(listTitle = '随行验证 · 编辑结构', itemTitle = '随行验证 · 合成事项') {
  return new JSDOM(`<div role="tree"><div role="treeitem" aria-selected="true"><button class="inline-editable-label">${listTitle}</button></div></div>
    <button class="add-reminder" aria-label="添加提醒事项">添加</button><div role="treegrid"><div role="row" class="reminder-item" id="synthetic-private-id">
    <div class="title"><div role="textbox" contenteditable="true">${itemTitle}</div></div>
    <input value="synthetic-private-value"/><div class="metadata"><time datetime="2030-01-01">合成日期文字</time></div></div></div>`);
}

test('编辑结构诊断拒绝普通清单或混入普通事项的验证清单', () => {
  for (const dom of [page('合成普通清单'), page(undefined, '合成普通事项')]) {
    assert.equal(diagnostics.inspectTestEditorDocument(dom.window.document).ok, false);
    dom.window.close();
  }
});

test('编辑结构只返回控件特征，不包含清单文字、事项文字、记录 ID 和输入值', () => {
  const dom = page();
  const result = diagnostics.inspectTestEditorDocument(dom.window.document);
  assert.equal(result.code, 'TEST_EDITOR_SHAPE');
  assert.equal(result.loadedTestItems, 1);
  assert.ok(result.rowFields.some(node => node.editable));
  assert.ok(result.rowFields.some(node => node.attributes.includes('datetime')));
  assert.doesNotMatch(JSON.stringify(result), /合成事项|编辑结构|synthetic-private|2030-01-01|合成日期文字/);
  dom.window.close();
});

test('编辑结构诊断遇到挂起或抛错时有界退出，不泄漏底层异常', async () => {
  assert.equal((await diagnostics.inspectTestEditor({ executeJavaScript: () => new Promise(() => {}) }, 10)).code, 'DIAGNOSTIC_TIMEOUT');
  const result = await diagnostics.inspectTestEditor({ executeJavaScript: () => Promise.reject(new Error('synthetic-private-error')) });
  assert.deepEqual(result, { ok: false, code: 'DIAGNOSTIC_FAILED' });
});
