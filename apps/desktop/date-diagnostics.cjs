/** 只检查专用测试事项的官方日期编辑结构；不输出正文、输入值、账户或记录标识。 */
async function inspectTestDetailsDocument(action = 'inspect', doc = document) {
  if (!['open','inspect','preview-date','binding','cancel'].includes(action)) return {ok:false,code:'INVALID_DIAGNOSTIC_ACTION'};
  const active=[...doc.querySelectorAll('[role="tree"] [role="treeitem"][aria-selected="true"]')];
  if (active.length !== 1 || !active[0].querySelector('.inline-editable-label')?.textContent.trim().startsWith('随行验证')) return {ok:false,code:'TEST_LIST_NOT_SELECTED'};
  const rows=[...doc.querySelectorAll('[role="treegrid"] .reminder-item[role="row"][id]')].filter(node=>!node.closest('[hidden], [aria-hidden="true"]'));
  if (!rows.length || rows.some(row=>!row.querySelector('.title [role="textbox"]')?.textContent.trim().startsWith('随行验证'))) return {ok:false,code:'TEST_ITEMS_REQUIRED'};
  const targets=rows.filter(row=>row.querySelector('.title [role="textbox"]')?.textContent.trim() === '随行验证 · 最小读写验证');
  if (targets.length !== 1) return {ok:false,code:'TEST_ITEM_NOT_UNIQUE'};
  const buttons=targets[0].querySelectorAll('button[data-edit-open][aria-haspopup="dialog"]');
  if (buttons.length !== 1) return {ok:false,code:'TEST_DETAILS_UNAVAILABLE'};
  const opener=buttons[0];
  if (action === 'binding') {
    const row=targets[0];
    const keys=Object.getOwnPropertyNames(row).filter(key=>key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$'));
    const shape={bindings:keys.length,kind:keys.length===1?keys[0].startsWith('__reactProps$')?'modern':'legacy':null,dueNodes:row.querySelectorAll('.due-date').length};
    if (keys.length!==1) return {ok:true,code:'TEST_DATE_BINDING_SHAPE',shape};
    const child=row[keys[0]]?.children;
    shape.childArray=Array.isArray(child);shape.hasChild=!!child;
    const record=!Array.isArray(child) && child?.props?.item;
    shape.hasRecord=!!record;
    if (record) {
      shape.identityMatches=typeof record.pk==='string' && 'reminder-item-'+record.pk===row.id;
      if (!shape.identityMatches) return {ok:true,code:'TEST_DATE_BINDING_SHAPE',shape};
      const due=record.DueDate,allDay=record.AllDay,zone=record.TimeZone;
      shape.dueType=due===null?'null':typeof due;shape.dueFinite=typeof due==='number' && Number.isFinite(due);shape.dueZero=due===0;
      shape.allDay=typeof allDay==='boolean'?allDay:allDay===null?'null':typeof allDay;
      shape.zoneKind=zone===null?'null':zone===undefined?'missing':zone===''?'empty':typeof zone;
      if (typeof zone==='string' && zone) {try {new doc.defaultView.Intl.DateTimeFormat('en-US',{timeZone:zone});shape.zoneValid=true;}catch {shape.zoneValid=false;}}
    }
    return {ok:true,code:'TEST_DATE_BINDING_SHAPE',shape};
  }
  const pause=()=>new Promise(resolve=>doc.defaultView.setTimeout(resolve,80));
  function activate(node) {
    const win=doc.defaultView;
    for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      const Constructor=type.startsWith('pointer') && win.PointerEvent || win.MouseEvent;
      node.dispatchEvent(new Constructor(type,{bubbles:true,cancelable:true,view:win,button:0,buttons:type.endsWith('down')?1:0,pointerId:1,pointerType:'mouse'}));
    }
  }
  if (action === 'open') {
    if (doc.querySelector('.details-popover') || opener.getAttribute('data-edit-open') === 'true') return {ok:false,code:'TEST_DETAILS_ALREADY_OPEN'};
    if (opener.disabled || opener.getAttribute('aria-disabled') === 'true') return {ok:false,code:'TEST_DETAILS_UNAVAILABLE'};
    activate(opener);
    for (let attempt=0;attempt<25 && !doc.querySelector('.reminder-item-details');attempt++) await pause();
  }
  function scopeStillCurrent() {
    const currentActive=[...doc.querySelectorAll('[role="tree"] [role="treeitem"][aria-selected="true"]')];
    const currentRows=[...doc.querySelectorAll('[role="treegrid"] .reminder-item[role="row"][id]')].filter(node=>!node.closest('[hidden], [aria-hidden="true"]'));
    return currentActive.length === 1 && currentActive[0] === active[0] && opener.isConnected && currentRows.includes(targets[0]) &&
      currentRows.every(row=>row.querySelector('.title [role="textbox"]')?.textContent.trim().startsWith('随行验证'));
  }
  if (!scopeStillCurrent()) return {ok:false,code:'TEST_SCOPE_CHANGED'};
  const panels=[...doc.querySelectorAll('.reminder-item-details')];
  if (panels.length !== 1 || opener.getAttribute('data-edit-open') !== 'true') return {ok:false,code:'TEST_DETAILS_NOT_OPEN'};
  const panel=panels[0];
  const popup=panel.closest('.details-popover') || panel;
  if (action === 'preview-date') {
    const dateSwitch=panel.querySelector('#atDate[role="switch"]');
    if (!dateSwitch || !['true','false'].includes(dateSwitch.getAttribute('aria-checked')) || dateSwitch.getAttribute('aria-disabled') === 'true') return {ok:false,code:'TEST_DATE_SWITCH_UNAVAILABLE'};
    if (dateSwitch.getAttribute('aria-checked') === 'false') activate(dateSwitch);
    for (let attempt=0;attempt<25 && !panel.querySelector('.date-field [role="spinbutton"]');attempt++) await pause();
    if (!scopeStillCurrent()) return {ok:false,code:'TEST_SCOPE_CHANGED'};
    if (!panel.isConnected || !panel.querySelector('.date-field [role="spinbutton"]')) return {ok:false,code:'TEST_DATE_PREVIEW_UNCERTAIN'};
    // 此动作只展开未保存的日期草稿；诊断没有存储入口，结束时必须取消。
  }
  if (action === 'cancel') {
    const cancel=[...popup.querySelectorAll('button,[role="button"],ui-button')].filter(node=>/^(取消|Cancel)$/i.test(node.textContent.trim()));
    if (cancel.length !== 1 || cancel[0].disabled || cancel[0].getAttribute('aria-disabled') === 'true') return {ok:false,code:'TEST_CANCEL_UNAVAILABLE'};
    activate(cancel[0]);
    for (let attempt=0;attempt<25 && doc.querySelector('.reminder-item-details');attempt++) await pause();
    return {ok:!doc.querySelector('.reminder-item-details'),code:doc.querySelector('.reminder-item-details')?'TEST_CANCEL_UNCERTAIN':'TEST_DETAILS_CANCELLED'};
  }
  const safeClasses=new Set(['reminder-item-details','reminder-edit-date','date-switch-container','date-time-container','date-picker','date-field','time-picker','time-field','calendar-container','time-switch-container','primary','secondary','block']);
  const numeric=node=>{
    const read=name=>{const value=node.getAttribute(name);return /^-?\d{1,4}$/.test(value || '')?Number(value):null;};
    return {now:read('aria-valuenow'),min:read('aria-valuemin'),max:read('aria-valuemax')};
  };
  const shape=node=>({tag:node.tagName.toLowerCase(),role:node.getAttribute('role') || '',
    classes:[...node.classList].filter(name=>safeClasses.has(name)),attributes:node.getAttributeNames().filter(name=>name!=='id'),
    knownId:['atDate','editTime'].includes(node.id)?node.id:null,
    checked:typeof node.checked==='boolean'?node.checked:node.hasAttribute('aria-checked')?node.getAttribute('aria-checked')==='true':null,
    editable:node.getAttribute('contenteditable')==='true',shadow:!!node.shadowRoot,
    dateField:!!node.closest('.date-field'),timeField:!!node.closest('.time-picker .field'),
    segment:node.getAttribute('role')==='spinbutton'?numeric(node):null});
  const nodes=[...popup.querySelectorAll('#atDate,#editTime,[role="switch"],[role="spinbutton"],.date-field,.date-time-container,.time-picker .field,ui-overlay-actions [role="button"]')];
  const win=doc.defaultView;
  const fixed=new win.Date('2030-01-15T00:00:00Z');
  const rowDate=/^(\d{4})[\/年-](\d{1,2})[\/月-](\d{1,2})日?$/.exec(targets[0].querySelector('.due-date')?.textContent.trim() || '');
  const dateInputs=[...panel.querySelectorAll('.date-picker input')].map(node=>{
    const match=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?(?:\[([A-Za-z0-9_+/-]{1,80})\])?)?$/.exec(node.value || '');
    return match?{date:match.slice(1,4).map(Number),hour:match[4]?Number(match[4]):null,minute:match[5]?Number(match[5]):null,offset:match[6] || null,zone:match[7] || null}:null;
  }).filter(Boolean);
  return {ok:true,code:'TEST_DETAILS_SHAPE',nodes:nodes.slice(0,40).map(shape),truncated:nodes.length>40,
    rowDateParts:rowDate?rowDate.slice(1).map(Number):null,dateInputs,
    clock:{zone:win.Intl.DateTimeFormat().resolvedOptions().timeZone,offsetNow:new win.Date().getTimezoneOffset(),fixedOffset:fixed.getTimezoneOffset(),fixedLocal:[fixed.getFullYear(),fixed.getMonth()+1,fixed.getDate(),fixed.getHours()]}};
}

async function inspectTestDetails(frame, action, timeoutMs = 3000) {
  if (!['open','inspect','preview-date','binding','cancel'].includes(action)) return {ok:false,code:'INVALID_DIAGNOSTIC_ACTION'};
  let timer;
  try {
    return await Promise.race([
      frame.executeJavaScript('('+inspectTestDetailsDocument.toString()+')('+JSON.stringify(action)+')',true),
      new Promise(resolve=>{timer=setTimeout(()=>resolve({ok:false,code:'DIAGNOSTIC_TIMEOUT'}),timeoutMs);})
    ]);
  } catch {return {ok:false,code:'DIAGNOSTIC_FAILED'};}
  finally {clearTimeout(timer);}
}

module.exports={inspectTestDetailsDocument,inspectTestDetails};
