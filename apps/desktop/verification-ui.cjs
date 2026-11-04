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

module.exports = { clickTestCompletion, editTestText };
