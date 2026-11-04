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

module.exports = { clickTestCompletion };
