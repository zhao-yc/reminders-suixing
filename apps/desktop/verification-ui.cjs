/** 开发验收使用的本地界面操作。函数在无 Node 权限的渲染器中执行，只点击一次目标圆圈。 */
async function clickTestCompletion(expected) {
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  for (let attempt = 0; attempt < 50; attempt++) {
    const list = document.querySelector('.list-content');
    if (list?.dataset.pageId === expected.pageId && list.dataset.listId === expected.listId) {
      // uni-app H5 的 button 会生成 uni-button；用业务属性定位，避免依赖生成标签和页签顺序。
      const tab = document.querySelector(`.tabs [data-status="${expected.completed ? 'completed' : 'pending'}"]`);
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
    const tab = document.querySelector(`.tabs [data-status="${expected.completed ? 'completed' : 'pending'}"]`);
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
  const tab=document.querySelector('.tabs [data-status="completed"]');
  if (list?.dataset.pageId !== expected.pageId || list.dataset.listId !== expected.listId || !tab || tab.disabled || ['true',''].includes(tab.getAttribute('disabled'))) return false;
  tab.click();
  await new Promise(resolve=>setTimeout(resolve,100));
  for(let attempt=0;attempt<80;attempt++) {
    const current=document.querySelector('.list-content');
    if (current?.dataset.pageId !== expected.pageId || current.dataset.listId !== expected.listId) return false;
    const currentTab=document.querySelector('.tabs [data-status="completed"]');
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
    const tab=document.querySelector('.tabs [data-status="'+(expected.completed?'completed':'pending')+'"]');
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

module.exports = { clickTestCompletion, editTestText, createTestItem, showTestCompleted, editTestSchedule };
