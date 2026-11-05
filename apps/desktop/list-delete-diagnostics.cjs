/** 仅在本轮专用空清单打开官方删除确认并取消，不读取或输出其他清单、账户及提示正文。 */
async function inspectTestListDeleteDocument(doc=document) {
  const expected='随行验证 · Windows 清单管理验证';
  const selected=[...doc.querySelectorAll('[role="tree"] [role="treeitem"][aria-selected="true"]')];
  const rows=[...doc.querySelectorAll('[role="treegrid"] .reminder-item[role="row"]')].filter(node=>!node.closest('[hidden],[aria-hidden="true"]'));
  if(selected.length!==1 || selected[0].querySelector('.inline-editable-label')?.textContent.trim()!==expected || rows.length) return {ok:false,code:'TEST_EMPTY_MANAGEMENT_REQUIRED'};
  const visible=node=>!node.closest('[hidden],[aria-hidden="true"]') && doc.defaultView.getComputedStyle(node).display!=='none';
  if([...doc.querySelectorAll('[role="alertdialog"],.reminder-list-detail,.details-popover')].some(visible)) return {ok:false,code:'TEST_EDITOR_ALREADY_OPEN'};
  const buttons=[...doc.querySelectorAll('.list-detail-button')].filter(visible);
  const disabled=node=>!node || node.disabled || node.getAttribute('aria-disabled')==='true';
  if(buttons.length!==1 || disabled(buttons[0])) return {ok:false,code:'TEST_LIST_MENU_UNAVAILABLE'};
  const pause=()=>new Promise(resolve=>doc.defaultView.setTimeout(resolve,80));
  const activate=node=>{for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){const Constructor=type.startsWith('pointer') && doc.defaultView.PointerEvent || doc.defaultView.MouseEvent;node.dispatchEvent(new Constructor(type,{bubbles:true,cancelable:true,view:doc.defaultView,button:0,buttons:type.endsWith('down')?1:0,pointerId:1,pointerType:'mouse'}));}};
  activate(buttons[0]);let actions=[];
  for(let attempt=0;attempt<25;attempt++){actions=[...doc.querySelectorAll('[role="menuitem"]')].filter(node=>visible(node) && /^(删除列表|删除清单|Delete List)$/i.test(node.textContent.trim()));if(actions.length)break;await pause();}
  if(actions.length!==1 || disabled(actions[0]) || !selected[0].isConnected || selected[0].getAttribute('aria-selected')!=='true') return {ok:false,code:'TEST_LIST_DELETE_UNAVAILABLE'};
  activate(actions[0]);let panels=[];
  for(let attempt=0;attempt<25;attempt++){panels=[...doc.querySelectorAll('[role="alertdialog"]')].filter(visible);if(panels.length)break;await pause();}
  if(panels.length!==1) return {ok:false,code:'TEST_DELETE_DIALOG_UNCONFIRMED'};
  const panel=panels[0],title=panel.querySelector('ui-alert-content h1.title,h1.title')?.textContent.trim() || '';
  const controls=[...panel.querySelectorAll('ui-alert-footer [role="button"],ui-alert-footer button')].filter(visible);
  const label=node=>/^(取消|Cancel)$/i.test(node.textContent.trim())?'cancel':/^(删除|Delete)$/i.test(node.textContent.trim())?'delete':'other';
  const normalized=title.replace(/[“”]/g,'"');
  const shape={titleHasExpectedName:title.includes(expected),unsharedTitle:['删除列表"'+expected+'"？','Delete List "'+expected+'"?','Delete "'+expected+'"?'].some(value=>value.toLowerCase()===normalized.toLowerCase()),
    footerButtons:controls.map(node=>({tag:node.tagName.toLowerCase(),role:node.getAttribute('role') || '',kind:label(node),disabled:!!disabled(node),destructive:node.classList.contains('destructive') || node.hasAttribute('destructive')}))};
  const cancel=controls.filter(node=>label(node)==='cancel');
  if(cancel.length!==1 || disabled(cancel[0])) return {ok:false,code:'TEST_DELETE_CANCEL_UNAVAILABLE',shape};
  activate(cancel[0]);for(let attempt=0;attempt<25 && panel.isConnected;attempt++)await pause();
  return {ok:!panel.isConnected,code:panel.isConnected?'TEST_DELETE_CANCEL_UNCONFIRMED':'TEST_DELETE_LIST_CANCELLED',shape};
}

async function inspectTestListDelete(frame,timeoutMs=7000) {
  let timer;
  try{return await Promise.race([frame.executeJavaScript('('+inspectTestListDeleteDocument.toString()+')()',true),new Promise(resolve=>{timer=setTimeout(()=>resolve({ok:false,code:'DIAGNOSTIC_TIMEOUT'}),timeoutMs);})]);}
  catch{return {ok:false,code:'DIAGNOSTIC_FAILED'};}
  finally{clearTimeout(timer);}
}

module.exports={inspectTestListDeleteDocument,inspectTestListDelete};
