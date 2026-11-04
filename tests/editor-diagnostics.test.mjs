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

test('新增清单结构诊断只取消自己的草稿，不读取输入值、不完成保存',async t=>{
  const dom=page();t.after(()=>dom.window.close());const doc=dom.window.document;let opened=0,cancelled=0,saved=0;
  const button=doc.createElement('button');button.className='new-list-button';doc.body.append(button);
  button.addEventListener('click',()=>{
    opened++;const panel=doc.createElement('div');panel.className='reminder-list-detail';
    panel.innerHTML='<div class="name-textfield"><input type="text" maxlength="128"></div><div class="color-picker"></div><div class="badge-emblem-picker"></div><button class="done-button">synthetic-private-done</button><button class="cancel-button">synthetic-private-cancel</button>';
    Object.defineProperty(panel.querySelector('input'),'value',{get(){assert.fail('结构诊断不得读取输入值');}});
    panel.querySelector('.done-button').addEventListener('click',()=>saved++);
    panel.querySelector('.cancel-button').addEventListener('click',()=>{cancelled++;panel.remove();});doc.body.append(panel);
  });
  const result=await diagnostics.inspectNewTestListDocument(doc);
  assert.equal(result.code,'TEST_NEW_LIST_CANCELLED');assert.equal(result.shape.nameInputs,1);assert.equal(result.shape.maximums[0],128);assert.equal(result.selectionRestored,true);
  assert.equal(opened,1);assert.equal(cancelled,1);assert.equal(saved,0);assert.doesNotMatch(JSON.stringify(result),/synthetic-private|合成事项|编辑结构/);
});

test('普通清单或已有编辑窗口不会被新增清单诊断激活或取消',async t=>{
  for(const existing of [false,true]) {
    const dom=page(existing?undefined:'合成普通清单');t.after(()=>dom.window.close());const doc=dom.window.document;let clicked=0;
    doc.body.insertAdjacentHTML('beforeend','<button class="new-list-button"></button>'+(existing?'<div class="reminder-list-detail"><button class="cancel-button"></button></div>':''));
    doc.body.addEventListener('click',()=>clicked++);
    assert.equal((await diagnostics.inspectNewTestListDocument(doc)).ok,false);assert.equal(clicked,0);
  }
  assert.equal((await diagnostics.inspectNewTestList({executeJavaScript:()=>new Promise(()=>{})},10)).code,'DIAGNOSTIC_TIMEOUT');
});
