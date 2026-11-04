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

module.exports = { inspectTestEditorDocument, inspectTestEditor };
