import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {inspectTestListDeleteDocument,inspectTestListDelete} from '../apps/desktop/list-delete-diagnostics.cjs';

function setup(t,title='随行验证 · Windows 清单管理验证') {
  const dom=new JSDOM('<div role="tree"><div role="treeitem" aria-selected="true"><span class="inline-editable-label"></span></div></div><div role="treegrid"></div><button class="list-detail-button"></button><div role="menu" hidden><button role="menuitem">删除列表</button></div>');
  t.after(()=>dom.window.close());const doc=dom.window.document;doc.querySelector('.inline-editable-label').textContent=title;
  let menus=0,confirmed=0,cancelled=0;
  doc.querySelector('.list-detail-button').addEventListener('click',()=>{menus++;doc.querySelector('[role="menu"]').hidden=false;});
  doc.querySelector('[role="menuitem"]').addEventListener('click',()=>{
    doc.querySelector('[role="menu"]').hidden=true;const panel=doc.createElement('div');panel.setAttribute('role','alertdialog');panel.className='for-ui-alert';
    panel.innerHTML='<ui-alert-content><h1 class="title"></h1><input value="synthetic-private-value"></ui-alert-content><ui-alert-footer><button role="button" class="destructive">删除</button><button role="button">取消</button><div aria-hidden="true"><button role="button">删除</button><button role="button">取消</button></div></ui-alert-footer>';
    panel.querySelector('h1').textContent='删除列表“'+title+'”？';
    panel.querySelector('.destructive').addEventListener('click',()=>confirmed++);
    panel.querySelector('ui-alert-footer > button:last-of-type').addEventListener('click',()=>{cancelled++;panel.remove();});doc.body.append(panel);
  });return {doc,counts:()=>({menus,confirmed,cancelled})};
}

test('只在专用空管理清单打开并取消确认，排除测量副本，不返回标题或输入值',async t=>{
  const {doc,counts}=setup(t);const result=await inspectTestListDeleteDocument(doc);
  assert.equal(result.code,'TEST_DELETE_LIST_CANCELLED');assert.equal(result.shape.unsharedTitle,true);assert.equal(result.shape.footerButtons.length,2);
  assert.deepEqual(counts(),{menus:1,confirmed:0,cancelled:1});assert.doesNotMatch(JSON.stringify(result),/synthetic-private|清单管理验证/);
});

test('普通清单、有事项或已有官方弹窗时不打开菜单、不接管已有确认',async t=>{
  for(const kind of ['ordinary','items','dialog']) {
    const {doc,counts}=setup(t,kind==='ordinary'?'合成普通清单':undefined);
    if(kind==='items')doc.querySelector('[role="treegrid"]').innerHTML='<div role="row" class="reminder-item"></div>';
    if(kind==='dialog')doc.body.insertAdjacentHTML('beforeend','<div role="alertdialog"><button>取消</button></div>');
    assert.equal((await inspectTestListDeleteDocument(doc)).ok,false);assert.deepEqual(counts(),{menus:0,confirmed:0,cancelled:0});
  }
});

test('确认检查挂起或异常时有界返回，不输出底层错误',async()=>{
  assert.equal((await inspectTestListDelete({executeJavaScript:()=>new Promise(()=>{})},10)).code,'DIAGNOSTIC_TIMEOUT');
  assert.equal((await inspectTestListDelete({executeJavaScript(){throw Error('synthetic-private');}})).code,'DIAGNOSTIC_FAILED');
});
