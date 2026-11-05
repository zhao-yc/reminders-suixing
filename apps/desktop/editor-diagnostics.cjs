/** 只输出专用验证清单的控件结构，不输出文字、记录 ID、输入值或属性值。 */
function inspectTestEditorDocument(doc = document) {
  const active = [...doc.querySelectorAll('[role="tree"] [role="treeitem"][aria-selected="true"]')];
  if (active.length !== 1 || !active[0].querySelector('.inline-editable-label')?.textContent.trim().startsWith('随行验证')) {
    return { ok: false, code: 'TEST_LIST_NOT_SELECTED' };
  }
  const rows = [...doc.querySelectorAll('[role="treegrid"] .reminder-item[role="row"][id]')]
    .filter(node => !node.closest('[hidden], [aria-hidden="true"]'));
  if (!rows.length || rows.some(row => !row.querySelector('.title [role="textbox"]')?.textContent.trim().startsWith('随行验证'))) {
    return { ok: false, code: 'TEST_ITEMS_REQUIRED' };
  }
  function shape(node) {
    const bounds = node.getBoundingClientRect();
    const style = doc.defaultView.getComputedStyle(node);
    return {
      tag: node.tagName.toLowerCase(), role: node.getAttribute('role') || '',
      classes: [...node.classList].filter(name => /^[a-z][a-z0-9_-]{0,63}$/i.test(name)).slice(0, 12),
      attributes: node.getAttributeNames().filter(name => name !== 'id').slice(0, 25),
      editable: node.getAttribute('contenteditable') === 'true',
      visible: bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
      editing: node.getAttribute('data-edit') === 'true',
      disabled: node.disabled === true || node.getAttribute('aria-disabled') === 'true'
    };
  }
  const controls = [...doc.querySelectorAll('button, [role="button"], [role="textbox"], input, textarea')]
    .filter(node => !node.closest('[role="tree"], .rm-list-menu-item'));
  return { ok: true, code: 'TEST_EDITOR_SHAPE', loadedTestItems: rows.length,
    listControls:{addButtons:doc.querySelectorAll('.new-list-button').length,visibleAddButtons:[...doc.querySelectorAll('.new-list-button')].filter(node=>shape(node).visible).length,
      menuButtons:doc.querySelectorAll('.list-detail-button').length},
    controls: controls.slice(0, 60).map(shape), controlsTruncated: controls.length > 60,
    rowFields: [...rows[0].querySelectorAll('*')].slice(0, 60).map(shape) };
}

async function inspectTestEditor(frame, timeoutMs = 2500) {
  let timer;
  try {
    return await Promise.race([
      frame.executeJavaScript('(' + inspectTestEditorDocument.toString() + ')()'),
      new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, code: 'DIAGNOSTIC_TIMEOUT' }), timeoutMs); })
    ]);
  } catch { return { ok: false, code: 'DIAGNOSTIC_FAILED' }; }
  finally { clearTimeout(timer); }
}

/** 只打开自己的新增清单草稿并取消，返回固定结构，不读取输入值或提交完成按钮。 */
async function inspectNewTestListDocument(doc=document) {
  const active=[...doc.querySelectorAll('[role="tree"] [role="treeitem"][aria-selected="true"]')];
  const rows=[...doc.querySelectorAll('[role="treegrid"] .reminder-item[role="row"]')].filter(node=>!node.closest('[hidden],[aria-hidden="true"]'));
  if(active.length!==1 || !active[0].querySelector('.inline-editable-label')?.textContent.trim().startsWith('随行验证') || rows.some(row=>!row.querySelector('.title [role="textbox"]')?.textContent.trim().startsWith('随行验证'))) return {ok:false,code:'TEST_SCOPE_REQUIRED'};
  if(doc.querySelector('.reminder-list-detail,.details-popover')) return {ok:false,code:'TEST_EDITOR_ALREADY_OPEN'};
  const buttons=[...doc.querySelectorAll('.new-list-button')].filter(node=>!node.closest('[hidden],[aria-hidden="true"]'));
  const disabled=node=>!node || node.disabled || node.getAttribute('aria-disabled')==='true';
  if(buttons.length!==1 || disabled(buttons[0])) return {ok:false,code:'TEST_NEW_LIST_UNAVAILABLE'};
  const pause=()=>new Promise(resolve=>doc.defaultView.setTimeout(resolve,80));
  const activate=node=>{for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {const Constructor=type.startsWith('pointer') && doc.defaultView.PointerEvent || doc.defaultView.MouseEvent;node.dispatchEvent(new Constructor(type,{bubbles:true,cancelable:true,view:doc.defaultView,button:0,buttons:type.endsWith('down')?1:0,pointerId:1,pointerType:'mouse'}));}};
  activate(buttons[0]);
  for(let attempt=0;attempt<25 && !doc.querySelector('.reminder-list-detail');attempt++) await pause();
  const panels=[...doc.querySelectorAll('.reminder-list-detail')];
  if(panels.length!==1) return {ok:false,code:'TEST_NEW_LIST_UNCONFIRMED'};
  const panel=panels[0],inputs=[...panel.querySelectorAll('.name-textfield input')],cancel=[...panel.querySelectorAll('.cancel-button')],done=[...panel.querySelectorAll('.done-button')];
  const shape={nameInputs:inputs.length,inputTypes:inputs.map(node=>['text','search'].includes(node.type)?node.type:'other'),
    maximums:inputs.map(node=>node.maxLength),cancelButtons:cancel.length,doneButtons:done.length,
    colorPickers:panel.querySelectorAll('.color-picker').length,iconPickers:panel.querySelectorAll('.badge-emblem-picker').length,
    appearanceOptions:['color-picker','badge-emblem-picker'].map(kind=>({kind,count:panel.querySelectorAll('.'+kind+' .picker-grid-item').length,selected:panel.querySelectorAll('.'+kind+' .picker-grid-item.is-selected').length,options:[...panel.querySelectorAll('.'+kind+' .picker-grid-item')].slice(0,3).map(node=>({
      tag:node.tagName.toLowerCase(),role:node.getAttribute('role') || '',classes:[...node.classList].filter(name=>/^[a-z][a-z0-9_-]{0,63}$/i.test(name)),
      attributes:node.getAttributeNames().filter(name=>name!=='id'),selected:node.classList.contains('is-selected'),
      color:/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/.test(node.style.backgroundColor)?node.style.backgroundColor:null,
      children:[...node.children].map(child=>({tag:child.tagName.toLowerCase(),classes:[...child.classList].filter(name=>/^[a-z][a-z0-9_-]{0,63}$/i.test(name)),attributes:child.getAttributeNames().filter(name=>name!=='id')}))
    }))}))};
  if(cancel.length!==1 || disabled(cancel[0])) return {ok:false,code:'TEST_NEW_LIST_CANCEL_UNAVAILABLE',shape};
  activate(cancel[0]);
  for(let attempt=0;attempt<25 && panel.isConnected;attempt++) await pause();
  if(panel.isConnected) return {ok:false,code:'TEST_NEW_LIST_CANCEL_UNCONFIRMED',shape};
  let restored=active[0].isConnected && active[0].getAttribute('aria-selected')==='true';
  if(!restored && active[0].isConnected && active[0].querySelector('.inline-editable-label')?.textContent.trim().startsWith('随行验证')) {
    activate(active[0]);for(let attempt=0;attempt<25 && active[0].getAttribute('aria-selected')!=='true';attempt++) await pause();
    restored=active[0].getAttribute('aria-selected')==='true';
  }
  return {ok:true,code:'TEST_NEW_LIST_CANCELLED',shape,selectionRestored:restored};
}

async function inspectNewTestList(frame,timeoutMs=6500) {
  let timer;
  try {return await Promise.race([frame.executeJavaScript('('+inspectNewTestListDocument.toString()+')()',true),new Promise(resolve=>{timer=setTimeout(()=>resolve({ok:false,code:'DIAGNOSTIC_TIMEOUT'}),timeoutMs);})]);}
  catch {return {ok:false,code:'DIAGNOSTIC_FAILED'};}
  finally {clearTimeout(timer);}
}

module.exports = { inspectTestEditorDocument, inspectTestEditor, inspectNewTestListDocument, inspectNewTestList };
