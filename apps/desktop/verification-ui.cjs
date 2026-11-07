/** 开发验收使用的本地界面操作。函数在无 Node 权限的渲染器中执行，只点击一次目标圆圈。 */
async function clickTestCompletion(expected) {
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  for (let attempt = 0; attempt < 50; attempt++) {
    const list = document.querySelector('.list-content');
    if (list?.dataset.pageId === expected.pageId && list.dataset.listId === expected.listId) {
      // uni-app H5 的 button 会生成 uni-button；用业务属性定位，避免依赖生成标签和页签顺序。
      const tab = document.querySelector(`:is(.tabs,.desktop-view-grid:not([data-scope=summary])) [data-status="${expected.completed ? 'completed' : 'pending'}"]`);
      if (!tab) return false;
      if (!tab.classList.contains('active')) tab.click();
      await pause();
      const rows = [...document.querySelectorAll('.reminder-row')].filter(row => row.dataset.recordId === expected.id);
      if (rows.length === 1) {
        const button = rows[0].querySelector('.completion-button');
        const disabled = button?.getAttribute('disabled');
        if (button && !button.disabled && disabled !== 'true' && disabled !== '' && button.getAttribute('aria-disabled') !== 'true' && button.classList.contains('checked') === expected.completed) {
          button.click();
          return true;
        }
      }
    }
    await pause();
  }
  return false;
}

/** 通过实际编辑入口、输入控件和保存按钮验证单次文字写入，不绕过页面业务状态。 */
async function editTestText(expected) {
  if (!['title', 'notes'].includes(expected.field) || typeof expected.value !== 'string') return false;
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  for (let attempt = 0; attempt < 50; attempt++) {
    const list = document.querySelector('.list-content');
    if (list?.dataset.pageId !== expected.pageId || list.dataset.listId !== expected.listId) { await pause(); continue; }
    const tab = document.querySelector(`:is(.tabs,.desktop-view-grid:not([data-scope=summary])) [data-status="${expected.completed ? 'completed' : 'pending'}"]`);
    if (!tab) return false;
    if (!tab.classList.contains('active')) { tab.click(); await pause(); }
    const rows = [...document.querySelectorAll('.reminder-row')].filter(row => row.dataset.recordId === expected.id);
    if (rows.length !== 1) { await pause(); continue; }
    const button = rows[0].querySelector(expected.field === 'title' ? '.edit-title-button' : '.edit-notes-button');
    const disabled = button?.getAttribute('disabled');
    if (!button || button.disabled || disabled === 'true' || disabled === '') return false;
    button.click();
    await pause();
    const input = rows[0].querySelector('.inline-editor input, .inline-editor textarea');
    if (!input || input.disabled) return false;
    const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, expected.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await pause();
    const save = rows[0].querySelector('.save-edit');
    if (!save || save.disabled || save.getAttribute('disabled') === 'true' || save.getAttribute('disabled') === '') return false;
    save.click();
    return true;
  }
  return false;
}

/** 新建验证只通过本地“＋”、标题输入和添加按钮各一次，不直接调用创建 IPC。 */
async function createTestItem(expected) {
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  for (let attempt = 0; attempt < 50; attempt++) {
    const list = document.querySelector('.list-content');
    if (list?.dataset.pageId !== expected.pageId || list.dataset.listId !== expected.listId) { await pause(); continue; }
    const add = document.querySelector('.add-reminder-button');
    if (!add || add.disabled || ['true', ''].includes(add.getAttribute('disabled'))) return false;
    add.click();
    await pause();
    const input = document.querySelector('.new-reminder-row input');
    if (!input || input.disabled) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, expected.title);
    input.dispatchEvent(new Event('input', { bubbles:true }));
    await pause();
    const save = document.querySelector('.new-reminder-row .save-edit');
    if (!save || save.disabled || ['true', ''].includes(save.getAttribute('disabled'))) return false;
    save.click();
    return true;
  }
  return false;
}

/** 显示完成项也走正式页签，只激活一次，等待异步显示请求结束后才返回。 */
async function showTestCompleted(expected) {
  const list=document.querySelector('.list-content');
  const tab=document.querySelector(':is(.tabs,.desktop-view-grid:not([data-scope=summary])) [data-status="completed"]');
  if (list?.dataset.pageId !== expected.pageId || list.dataset.listId !== expected.listId || !tab || tab.disabled || ['true',''].includes(tab.getAttribute('disabled'))) return false;
  tab.click();
  await new Promise(resolve=>setTimeout(resolve,100));
  for(let attempt=0;attempt<80;attempt++) {
    const current=document.querySelector('.list-content');
    if (current?.dataset.pageId !== expected.pageId || current.dataset.listId !== expected.listId) return false;
    const currentTab=document.querySelector(':is(.tabs,.desktop-view-grid:not([data-scope=summary])) [data-status="completed"]');
    if (currentTab?.classList.contains('active') && !currentTab.disabled && !['true',''].includes(currentTab.getAttribute('disabled'))) return !document.querySelector('.notice.error');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  return false;
}

/** 日期验收操作本地编辑入口、开关、输入和保存，禁止直接调用写入 IPC。 */
async function editTestSchedule(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
  const disabled=node=>!node || node.disabled || ['true',''].includes(node.getAttribute('disabled'));
  let row;
  for(let attempt=0;attempt<80;attempt++) {
    const list=document.querySelector('.list-content');
    if (list?.dataset.pageId!==expected.pageId || list.dataset.listId!==expected.listId) {await pause();continue;}
    const tab=document.querySelector(':is(.tabs,.desktop-view-grid:not([data-scope=summary])) [data-status="'+(expected.completed?'completed':'pending')+'"]');
    if (!tab) return false;
    if (!tab.classList.contains('active') && !disabled(tab)) {tab.click();await pause();}
    const rows=[...document.querySelectorAll('.reminder-row')].filter(node=>node.dataset.recordId===expected.id);
    row=rows.length===1?rows[0]:null;
    const button=row?.querySelector('.edit-schedule-button');
    if (!disabled(button)) {button.click();break;}
    await pause();
  }
  if (!row) return false;
  for(let attempt=0;attempt<80 && !row.querySelector('.schedule-editor');attempt++) await pause();
  const editor=row.querySelector('.schedule-editor');
  if (!editor) return false;
  const dateSwitch=editor.querySelector('.schedule-date-toggle');
  const useDate=expected.value.date!==null;
  if (disabled(dateSwitch)) return false;
  if (dateSwitch.getAttribute('aria-checked')!==String(useDate)) {dateSwitch.click();await pause();}
  function input(selector,value) {
    const node=editor.querySelector(selector);if (disabled(node)) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);
    node.dispatchEvent(new Event('input',{bubbles:true}));return true;
  }
  if (useDate) {
    if (!input('.schedule-date-input input, input.schedule-date-input',expected.value.date)) return false;
    const timeSwitch=editor.querySelector('.schedule-time-toggle');
    const timed=expected.value.time!==null;
    if (disabled(timeSwitch)) return false;
    if (timeSwitch.getAttribute('aria-checked')!==String(timed)) {timeSwitch.click();await pause();}
    if (timed && !input('.schedule-time-input input, input.schedule-time-input',expected.value.time)) return false;
  }
  await pause();
  if (expected.preview === true) return true;
  const save=row.querySelector('.save-edit');if (disabled(save)) return false;
  save.click();return true;
}

/** 只在专用清单操作本地排序菜单，结束恢复原设置；没有任何事项编辑入口。 */
async function verifyTestSorting(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
  const labels=['清单顺序','日期：从早到晚','日期：从晚到早','标题：升序','标题：降序','优先级：从高到低','优先级：从低到高'];
  function scope() {
    const list=document.querySelector('.list-content'),rows=[...document.querySelectorAll('.reminder-row[data-record-id]')];
    return list?.dataset.pageId===expected.pageId && list.dataset.listId===expected.listId && !document.querySelector('.inline-editor') &&
      rows.length>0 && rows.length===expected.ids.length && rows.every(row=>expected.ids.includes(row.dataset.recordId) && row.querySelector('.reminder-title')?.textContent.trim().startsWith('随行验证')) &&
      (!expected.priorities || expected.priorities.every(item=>{
        const row=rows.find(row=>row.dataset.recordId===item.id),marks={high:'!!!',medium:'!!',low:'!',none:''};
        return row && (row.querySelector('.priority-mark')?.textContent || '')===(marks[item.priority] || '') &&
          (item.priority===null?row.textContent.includes('优先级不可读'):row.dataset.priority===item.priority);
      }));
  }
  const selected=()=>document.querySelector('.sort-picker-label')?.textContent.replace(/\s*⌄\s*$/,'').trim();
  const original=selected();
  if (!scope() || !labels.includes(original)) return false;
  async function choose(label) {
    if (!scope()) return false;
    const picker=document.querySelector('.sort-picker');
    if (!picker || picker.disabled || ['true',''].includes(picker.getAttribute('disabled'))) return false;
    picker.querySelector('.sort-picker-label').click();
    for (let attempt=0;attempt<30;attempt++) {
      if (!scope()) return false;
      const options=[...document.querySelectorAll('.uni-picker-select .uni-picker-item, .sort-menu .sort-option')].filter(node=>(node.querySelector('.sort-option-label')?.textContent || node.textContent).trim()===label);
      if (options.length===1) {options[0].click();await pause();return scope() && selected()===label;}
      await pause();
    }
    return false;
  }
  let verified=false;
  try {verified=await choose('日期：从早到晚') && await choose('标题：升序') && await choose('优先级：从高到低') && await choose('优先级：从低到高');}
  finally {if (selected()!==original && !await choose(original)) verified=false;}
  return verified && scope() && selected()===original;
}

/** 旗标验收只点击本地目标行一次，使用正式命令；不访问官方详情或私有写入接口。 */
async function clickTestFlag(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
  for(let attempt=0;attempt<50;attempt++) {
    const list=document.querySelector('.list-content');
    if(list?.dataset.pageId!==expected.pageId || list.dataset.listId!==expected.listId) {await pause();continue;}
    const tab=document.querySelector(':is(.tabs,.desktop-view-grid:not([data-scope=summary])) [data-status="'+(expected.completed?'completed':'pending')+'"]');
    if(!tab || tab.hasAttribute('disabled')) return false;
    if(!tab.classList.contains('active')) {tab.click();await pause();continue;}
    const rows=[...document.querySelectorAll('.reminder-row')].filter(row=>row.dataset.recordId===expected.id);
    const button=rows.length===1 && rows[0].querySelector('.flag-toggle-button');
    if(!button || button.disabled || button.hasAttribute('disabled') || button.getAttribute('aria-pressed')!==String(expected.flagged)) return false;
    button.click();return true;
  }
  return false;
}

/** 从本地正式入口重新连接一次，等待新页面与原清单恢复；不触发任何事项写入。 */
async function reconnectTestClient(expected) {
  const failed=(reason,kind,stage)=>expected.details===true?{ok:false,reason,kind,stage}:false;
  let list,button;const readyDeadline=Date.now()+5000;
  for(let attempt=0;attempt<35;attempt++) {
    list=document.querySelector('.list-content');button=document.querySelector('.reconnect-button');
    if(list?.dataset.pageId===expected.pageId && list.dataset.listId===expected.listId && !document.querySelector('.inline-editor') && button && !button.hasAttribute('disabled')) break;
    if(Date.now()>=readyDeadline) break;
    await new Promise(resolve=>setTimeout(resolve,120));
  }
  if(list?.dataset.pageId!==expected.pageId || list.dataset.listId!==expected.listId || document.querySelector('.inline-editor') || !button || button.hasAttribute('disabled')) return failed('UI_NOT_READY');
  button.click();
  for(let attempt=0;attempt<450;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,200));
    const current=document.querySelector('.list-content'),control=document.querySelector('.reconnect-button');
    if(control && !control.hasAttribute('disabled')) {
      const error=document.querySelector('.notice.error');
      if(error) {
        const code=error.dataset?.code;
        const phase=error.dataset?.reconnectStage,stage=['home','reminders','opening','waiting-navigation','selecting-list','waiting-selected'].includes(phase)?phase:undefined;
        if(['OFFICIAL_PAGE_BUSY','RECONNECT_FAILED','PAGE_NOT_READY','BUSY','STALE_VIEW','RECONNECT_TIMEOUT','NAVIGATION_FAILED','NAVIGATION_TIMEOUT','BRIDGE_TIMEOUT'].includes(code))return failed('UI_ERROR',code,stage);
        const message=error.textContent.trim(),known={'重新连接暂不可用，请在官方页面核对。':'RECONNECT_FAILED','官方页面尚未就绪，请完成登录或稍后读取。':'PAGE_NOT_READY','请等待当前操作结束后再重新连接。':'BUSY','清单位置已变化，请重新读取并选择清单。':'STALE_VIEW','重新连接未完成，请打开官方页面核对。':'NAVIGATION_FAILED','重新连接超时，请稍后读取或打开官方页面核对。':'NAVIGATION_TIMEOUT'};
        return failed('UI_ERROR',Object.hasOwn(known,message)?known[message]:'OTHER');
      }
      if(current?.dataset.pageId && current.dataset.pageId!==expected.pageId) return current.dataset.live==='true' && (current.dataset.listTitle ?? document.querySelector('.list-title')?.textContent.trim())===expected.title?true:failed('VIEW_NOT_RESTORED');
    }
  }
  return failed('OBSERVATION_TIMEOUT');
}

/** 删除验收必须经过本地预检及确认界面；只操作匹配的专用测试行。 */
async function deleteTestItem(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
  const disabled=node=>!node || node.disabled || ['true',''].includes(node.getAttribute('disabled'));
  const list=document.querySelector('.list-content');
  if(list?.dataset.pageId!==expected.pageId || list.dataset.listId!==expected.listId || !expected.title?.startsWith('随行验证') || document.querySelector('.inline-editor')) return false;
  const rows=[...document.querySelectorAll('.reminder-row[data-record-id]')].filter(row=>row.dataset.recordId===expected.id);
  const row=rows.length===1?rows[0]:null,button=row?.querySelector('.delete-item-button');
  if(!row || row.querySelector('.reminder-title')?.textContent.trim()!==expected.title || disabled(button)) return false;
  button.click();
  for(let attempt=0;attempt<130;attempt++) {
    const current=document.querySelector('.list-content');
    if(current?.dataset.pageId!==expected.pageId || current.dataset.listId!==expected.listId || !row.isConnected) return false;
    const confirmation=row.querySelector('.delete-confirmation');
    if(confirmation) {
      if(!confirmation.textContent.includes(expected.title)) return false;
      if(expected.preview===true) return true;
      const action=row.querySelector(expected.cancel===true?'.cancel-delete':'.confirm-delete');
      if(disabled(action)) return false;
      action.click();
      if(expected.cancel===true) {await pause();return !document.querySelector('.inline-editor') && row.isConnected;}
      return true;
    }
    if(document.querySelector('.notice.error')) return false;
    await pause();
  }
  return false;
}

/** 清单写入验收只填写本地名称编辑器，仍经正式 IPC 与官方表单单次提交。 */
async function editTestList(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
  const disabled=node=>!node || node.disabled || ['true',''].includes(node.getAttribute('disabled'));
  if(!['create','rename'].includes(expected.operation) || !expected.value?.startsWith('随行验证') || !expected.title?.startsWith('随行验证')) return false;
  let list;const readyDeadline=Date.now()+5000;
  for(let attempt=0;attempt<35;attempt++) {
    list=document.querySelector('.list-content');
    if(list?.dataset.pageId===expected.pageId && list.dataset.listId===expected.listId && (list.dataset.listTitle ?? document.querySelector('.list-title')?.textContent.trim())===expected.title && !document.querySelector('.inline-editor')) break;
    if(Date.now()>=readyDeadline) break;await pause();
  }
  if(list?.dataset.pageId!==expected.pageId || list.dataset.listId!==expected.listId ||
    (list?.dataset.listTitle ?? document.querySelector('.list-title')?.textContent.trim())!==expected.title || !expected.title?.startsWith('随行验证') || document.querySelector('.inline-editor')) return false;
  const button=document.querySelector(expected.operation==='create'?'.add-list-button':'.rename-list-button');
  if(disabled(button)) return false;button.click();
  for(let attempt=0;attempt<35 && disabled(document.querySelector('.list-editor input'));attempt++) await pause();
  const editor=document.querySelector('.list-editor'),current=document.querySelector('.list-content');
  if(!editor || editor.dataset.operation!==expected.operation || current?.dataset.pageId!==expected.pageId || current.dataset.listId!==expected.listId) return false;
  const input=editor.querySelector('.list-name-input input,input.list-name-input');
  if(disabled(input)) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,expected.value);
  input.dispatchEvent(new Event('input',{bubbles:true}));await pause();
  if(expected.preview===true) return true;
  const action=editor.querySelector(expected.cancel===true?'.cancel-list-edit':'.save-list-edit');
  if(disabled(action)) return false;action.click();
  if(expected.cancel===true) {await pause();return !document.querySelector('.list-editor');}
  return true;
}

/** 清单删除只在匹配的本地确认界面提交一次，不直接激活官方删除按钮。 */
async function deleteTestList(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,100)),disabled=node=>!node || node.disabled || ['true',''].includes(node.getAttribute('disabled'));
  if(!expected.title?.startsWith('随行验证'))return false;
  const deadline=Date.now()+5000;let list,button;
  for(let attempt=0;attempt<45;attempt++) {
    list=document.querySelector('.list-content');button=document.querySelector('.delete-list-button');
    if(list?.dataset.pageId===expected.pageId && list.dataset.listId===expected.listId && (list.dataset.listTitle ?? document.querySelector('.list-title')?.textContent.trim())===expected.title && !document.querySelector('.inline-editor') && !disabled(button))break;
    if(Date.now()>=deadline)break;await pause();
  }
  if(list?.dataset.pageId!==expected.pageId || list.dataset.listId!==expected.listId || document.querySelector('.inline-editor') || disabled(button))return false;
  button.click();await pause();
  const panel=document.querySelector('.list-delete-confirmation');
  if(!panel || !panel.querySelector('.delete-title')?.textContent.includes(expected.title))return false;
  if(expected.preview===true)return true;
  const action=panel.querySelector(expected.cancel===true?'.cancel-list-delete':'.confirm-list-delete');
  if(disabled(action))return false;action.click();
  if(expected.cancel===true){await pause();return !document.querySelector('.inline-editor') && document.querySelector('.list-content')?.dataset.listId===expected.listId;}
  return true;
}

/** 导航快照之后从本地侧栏明确选择专用清单，等待正式读取恢复编辑状态。 */
async function selectTestListClient(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,150));
  if(!expected.title?.startsWith('随行验证'))return false;
  let button;const deadline=Date.now()+5000;
  for(let attempt=0;attempt<40;attempt++) {
    const list=document.querySelector('.list-content');
    button=[...document.querySelectorAll('.list-button[data-list-id]')].find(node=>node.dataset.listId===expected.listId && node.querySelector('.list-name')?.textContent.trim()===expected.title);
    if(list?.dataset.pageId===expected.pageId && button && !button.hasAttribute('disabled') && !document.querySelector('.inline-editor'))break;
    if(Date.now()>=deadline)break;await pause();
  }
  if(!button || button.hasAttribute('disabled') || document.querySelector('.inline-editor') || document.querySelector('.list-content')?.dataset.pageId!==expected.pageId)return false;
  button.click();
  for(let attempt=0;attempt<80;attempt++) {
    await pause();const list=document.querySelector('.list-content');
    if(list?.dataset.pageId!==expected.pageId || document.querySelector('.notice.error'))return false;
    if(list.dataset.listId===expected.listId && list.dataset.live==='true')return true;
  }
  return false;
}

/** 验收仅选择本地已读取的外观选项；正式 IPC 会重新核对官方面板。 */
async function editTestListAppearance(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,100)),disabled=node=>!node || node.disabled || node.hasAttribute('disabled');
  const list=document.querySelector('.list-content'),button=document.querySelector('.list-appearance-button');
  if(!expected.title?.startsWith('随行验证') || list?.dataset.pageId!==expected.pageId || list.dataset.listId!==expected.listId || (list.dataset.listTitle ?? document.querySelector('.list-title')?.textContent.trim())!==expected.title || document.querySelector('.inline-editor') || disabled(button))return false;
  button.click();let editor;
  for(let attempt=0;attempt<60;attempt++){await pause();editor=document.querySelector('.appearance-editor');if(editor)break;if(document.querySelector('.notice.error'))return false;}
  if(!editor)return false;
  const color=[...editor.querySelectorAll('.color-choice')].find(node=>node.dataset.key===expected.color),icon=[...editor.querySelectorAll('.icon-choice')].find(node=>node.dataset.key===expected.iconKey);
  if(disabled(color) || disabled(icon))return false;
  color.click();icon.click();await pause();
  if(expected.preview===true)return true;
  const action=editor.querySelector(expected.cancel?'.cancel-list-appearance':'.save-list-appearance');
  if(disabled(action))return false;action.click();
  if(expected.cancel){await pause();return !document.querySelector('.inline-editor');}
  return true;
}

/** 层级验收只在匹配的本地确认中提交，预检不直接发送官方快捷键。 */
async function editTestSubtask(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,100)),disabled=node=>!node || node.disabled || node.hasAttribute('disabled');
  const list=document.querySelector('.list-content'),row=[...document.querySelectorAll('.reminder-row')].find(row=>row.dataset.recordId===expected.id),button=row?.querySelector('.subtask-item-button');
  if(!expected.title?.startsWith('随行验证') || list?.dataset.pageId!==expected.pageId || list.dataset.listId!==expected.listId || row?.querySelector('.reminder-title')?.textContent.trim()!==expected.title || document.querySelector('.inline-editor') || disabled(button))return false;
  button.click();let panel;
  for(let attempt=0;attempt<120;attempt++){await pause();panel=row.querySelector('.subtask-confirmation');if(panel)break;if(document.querySelector('.notice.error'))return false;}
  if(!panel || !panel.querySelector('.delete-title')?.textContent.includes(expected.title))return false;
  if(expected.preview)return true;
  const action=row.querySelector(expected.cancel?'.cancel-subtask':'.confirm-subtask');if(disabled(action))return false;action.click();
  if(expected.cancel){await pause();return !document.querySelector('.inline-editor');}
  return true;
}

module.exports = { clickTestCompletion, editTestText, createTestItem, showTestCompleted, editTestSchedule, verifyTestSorting, clickTestFlag, reconnectTestClient, deleteTestItem, editTestList, deleteTestList, selectTestListClient, editTestListAppearance, editTestSubtask };
