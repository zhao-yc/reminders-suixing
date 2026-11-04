import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {inspectTestDetailsDocument,inspectTestDetails} from '../apps/desktop/date-diagnostics.cjs';

function setup(t,listTitle='随行验证 · 日期结构') {
  const dom=new JSDOM('<div role="tree"><div role="treeitem" aria-selected="true"><button class="inline-editable-label"></button></div></div><div role="treegrid"><div role="row" class="reminder-item" id="synthetic-private-record"><div class="title"><div role="textbox">随行验证 · 最小读写验证</div></div><button data-edit-open="false" aria-haspopup="dialog">详情</button></div></div>');
  t.after(()=>dom.window.close());
  const doc=dom.window.document;
  doc.querySelector('.inline-editable-label').textContent=listTitle;
  const opener=doc.querySelector('[data-edit-open]');let opened=0;let cancelled=0;let saved=0;
  opener.addEventListener('click',()=>{
    opened++;opener.setAttribute('data-edit-open','true');
    const popup=doc.createElement('div');popup.className='details-popover';
    popup.innerHTML='<div class="reminder-item-details"><input type="password" value="synthetic-private-value"><div class="date-field"><div role="spinbutton" contenteditable="true" aria-valuenow="2026" aria-valuemin="1" aria-valuemax="9999" id="synthetic-private-control">synthetic-private-text</div></div></div><button class="secondary">取消</button><button class="primary">存储</button>';
    popup.querySelector('.secondary').addEventListener('click',()=>{cancelled++;popup.remove();opener.setAttribute('data-edit-open','false');});
    popup.querySelector('.primary').addEventListener('click',()=>saved++);
    doc.body.append(popup);
  });
  return {doc,opener,counts:()=>({opened,cancelled,saved})};
}

test('日期结构诊断拒绝普通清单，不打开详情',async t=>{
  const {doc,counts}=setup(t,'合成普通清单');
  assert.equal((await inspectTestDetailsDocument('open',doc)).code,'TEST_LIST_NOT_SELECTED');
  assert.deepEqual(counts(),{opened:0,cancelled:0,saved:0});
});

test('仅打开专用详情一次，返回结构和数值分段，不返回正文标识或输入值',async t=>{
  const {doc,counts}=setup(t);
  Object.defineProperty(doc.body,'innerText',{get(){assert.fail('不得读取页面正文');}});
  const result=await inspectTestDetailsDocument('open',doc);
  assert.equal(result.code,'TEST_DETAILS_SHAPE');
  assert.ok(result.nodes.some(node=>node.dateField && node.segment?.now===2026));
  assert.doesNotMatch(JSON.stringify(result),/synthetic-private|日期结构|最小读写验证/);
  assert.equal((await inspectTestDetailsDocument('open',doc)).code,'TEST_DETAILS_ALREADY_OPEN');
  assert.equal((await inspectTestDetailsDocument('cancel',doc)).code,'TEST_DETAILS_CANCELLED');
  assert.deepEqual(counts(),{opened:1,cancelled:1,saved:0});
});

test('打开详情期间混入非测试事项时停止，不读取弹窗控件',async t=>{
  const {doc,opener}=setup(t);
  opener.addEventListener('click',()=>{doc.querySelector('.title [role="textbox"]').textContent='合成普通事项';});
  assert.equal((await inspectTestDetailsDocument('open',doc)).code,'TEST_SCOPE_CHANGED');
});

test('日期预览只展开未保存草稿，重复预览不反转，结束使用取消而不存储',async t=>{
  const {doc,counts}=setup(t);
  await inspectTestDetailsDocument('open',doc);
  const dateSwitch=doc.createElement('div');dateSwitch.id='atDate';dateSwitch.setAttribute('role','switch');dateSwitch.setAttribute('aria-checked','false');
  let clicks=0;
  dateSwitch.addEventListener('click',()=>{clicks++;dateSwitch.setAttribute('aria-checked',String(dateSwitch.getAttribute('aria-checked')!=='true'));});
  doc.querySelector('.reminder-item-details').append(dateSwitch);
  for(let i=0;i<2;i++) assert.equal((await inspectTestDetailsDocument('preview-date',doc)).ok,true);
  assert.equal(clicks,1);assert.equal(dateSwitch.getAttribute('aria-checked'),'true');
  assert.equal((await inspectTestDetailsDocument('cancel',doc)).ok,true);
  assert.deepEqual(counts(),{opened:1,cancelled:1,saved:0});
});

test('日期结构诊断只接受固定动作，挂起和异常都不会泄漏底层信息',async()=>{
  assert.equal((await inspectTestDetails({executeJavaScript(){assert.fail('非法动作不得执行');}},'save')).code,'INVALID_DIAGNOSTIC_ACTION');
  assert.equal((await inspectTestDetails({executeJavaScript:()=>new Promise(()=>{})},'inspect',10)).code,'DIAGNOSTIC_TIMEOUT');
  assert.deepEqual(await inspectTestDetails({executeJavaScript:()=>Promise.reject(Error('synthetic-private-error'))},'inspect'),{ok:false,code:'DIAGNOSTIC_FAILED'});
});

test('绑定诊断只输出类型和匹配状态，不输出记录标识、日期值或时区原文',async t=>{
  const {doc,counts}=setup(t);const row=doc.querySelector('.reminder-item');row.id='reminder-item-synthetic-private-record';
  const allowed=new Set(['pk','DueDate','AllDay','TimeZone']);
  const item=new Proxy({pk:'synthetic-private-record',DueDate:null,AllDay:null,TimeZone:'synthetic-private-token'},{get(record,key){assert.ok(allowed.has(key));return record[key];},ownKeys(){assert.fail('不得枚举记录');}});
  Object.defineProperty(row,'__reactEventHandlers$fixture',{value:{children:{props:{item}}}});
  Object.defineProperty(row,'__reactInternalInstance$fixture',{get(){assert.fail('不得读取内部实例');}});
  const result=await inspectTestDetailsDocument('binding',doc);
  assert.equal(result.shape.identityMatches,true);assert.equal(result.shape.dueType,'null');assert.equal(result.shape.zoneValid,false);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-private|日期结构|最小读写验证/);
  assert.deepEqual(counts(),{opened:0,cancelled:0,saved:0});
});
