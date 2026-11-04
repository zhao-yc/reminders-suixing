/* 提醒事项网页共用适配器。仅访问页面 DOM，不接触密码、Cookie 或私有网络接口。 */
(function installSuixingAdapter(root) {
  'use strict';
  if (root.__suixingAdapter && root.__suixingAdapter.version === '0.1.8') return;

  var pageId = 'page-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var listHandles = new WeakMap();
  var nextHandle = 0;
  var inFlight = false;
  var lastSnapshot = null;

  function result(ok, code, message, extra) {
    return Object.assign({ ok: ok, code: code, message: message }, extra || {});
  }

  /** 只递归同源 iframe；跨域登录页保留给用户操作，不尝试绕过浏览器限制。 */
  function documents() {
    var output = [];
    function visit(doc, depth) {
      if (!doc || depth > 6 || output.indexOf(doc) >= 0) return;
      output.push(doc);
      Array.from(doc.querySelectorAll('iframe')).forEach(function (frame) {
        try { visit(frame.contentDocument, depth + 1); } catch (_) { /* 跨域文档不可读取。 */ }
      });
    }
    visit(root.document, 0);
    return output;
  }

  function application() {
    return documents().find(function (doc) {
      return doc.querySelector('[role="tree"] .rm-list-menu-item') ||
        doc.querySelector('[role="treegrid"] .reminder-item') ||
        doc.querySelector('[role="tree"][aria-label="Reminder Lists"], [role="tree"][aria-label="提醒事项列表"]');
    });
  }

  /** 读取文字时去除仅供辅助技术使用的重复文本，不依赖中英文按钮文案。 */
  function text(node) {
    if (!node) return '';
    var clone = node.cloneNode(true);
    Array.from(clone.querySelectorAll('[aria-hidden="true"], [hidden], script, style')).forEach(function (el) { el.remove(); });
    return (clone.textContent || '').replace(/\u200b/g, '').trim();
  }

  function listNodes(doc) {
    return Array.from(doc.querySelectorAll('[role="tree"] [role="treeitem"]')).filter(function (el) {
      return el.querySelector('.inline-editable-label');
    });
  }

  function handle(node) {
    if (!listHandles.has(node)) listHandles.set(node, 'list-' + (++nextHandle));
    return listHandles.get(node);
  }

  function listName(node) { return text(node && node.querySelector('.inline-editable-label')); }

  function rowNodes(doc) {
    return Array.from(doc.querySelectorAll('[role="treegrid"] .reminder-item[role="row"][id]')).filter(function (node) {
      return !node.closest('[hidden], [aria-hidden="true"]');
    });
  }

  function readItem(row, activeListId) {
    var button = row.querySelector('button.mark-completed[data-completed]');
    var title = row.querySelector('.title [role="textbox"]');
    if (!button || !title || !text(title)) return null;
    var completed = button.getAttribute('data-completed') === 'true';
    var fullNotes = editableText(row.querySelector('.notes [role="textbox"]'));
    var item = {
      id: row.id,
      title: text(title),
      notes: fullNotes.slice(0, 2000),
      notesTruncated: fullNotes.length > 2000,
      metadata: text(row.querySelector('.metadata')).slice(0, 2000),
      completed: completed,
      listId: activeListId,
      level: Number(row.getAttribute('aria-level') || 1),
      disabled: button.disabled || button.getAttribute('aria-disabled') === 'true'
    };
    // 记录 ID 与内容指纹同时匹配，避免同名事项、切换列表或旧缓存导致误操作。
    item.fingerprint = JSON.stringify([item.id, item.title, item.notes, item.metadata, item.completed, activeListId]);
    return item;
  }

  function editableText(node) {
    if (!node) return '';
    var output = '';
    function visit(current) {
      if (current.nodeType === 3) { output += current.nodeValue; return; }
      if (current.nodeType !== 1 || current.matches('[hidden], [aria-hidden="true"], script, style')) return;
      if (current.tagName === 'BR') { output += '\n'; return; }
      var block = current !== node && ['DIV', 'P'].includes(current.tagName);
      if (block && output && !output.endsWith('\n')) output += '\n';
      Array.from(current.childNodes).forEach(visit);
      if (block && !output.endsWith('\n')) output += '\n';
    }
    visit(node);
    return output.replace(/\u200b/g, '').replace(/\r\n?/g, '\n').trim();
  }

  function read() {
    var doc = application();
    if (!doc) {
      lastSnapshot = null;
      return result(false, 'PAGE_NOT_READY', '请在 iCloud 官方页面完成登录，等待清单出现后再读取。');
    }
    if (isLoading(doc)) {
      lastSnapshot = null;
      return result(false, 'LIST_LOADING', 'iCloud 正在加载列表，请稍后重新读取。');
    }
    var nodes = listNodes(doc);
    var lists = nodes.map(function (node) {
      var icon = node.querySelector('.reminder-list-icon');
      return {
        id: handle(node), title: listName(node),
        selected: node.getAttribute('aria-selected') === 'true',
        color: icon && icon.style.backgroundColor || '#1687ff'
      };
    });
    var active = lists.find(function (item) { return item.selected; });
    if (!active) {
      lastSnapshot = null;
      return result(false, 'SELECT_A_LIST', '请先在官方页面选择一个提醒事项列表。', { lists: lists });
    }
    var rows = rowNodes(doc);
    var items = rows.map(function (node) { return readItem(node, active.id); }).filter(Boolean);
    var expectedCount = rows.reduce(function (max, node) {
      return Math.max(max, Number(node.getAttribute('aria-setsize') || 0));
    }, 0);
    var snapshot = {
      pageId: pageId, capturedAt: new Date().toISOString(), lists: lists,
      activeListId: active.id, activeListTitle: active.title,
      items: items, loadedCount: items.length, expectedCount: expectedCount,
      partial: expectedCount > items.length,
      coverage: '当前列表在网页中已加载的事项', source: 'icloud-web-dom'
    };
    lastSnapshot = snapshot;
    return result(true, 'READY', '已读取当前列表。', { snapshot: snapshot });
  }

  /** 只等待状态变化，不在超时后重复点击任何写入按钮。 */
  function until(predicate, timeout) {
    var deadline = Date.now() + timeout;
    return new Promise(function (resolve) {
      function poll() {
        var value = predicate();
        if (value) return resolve(value);
        if (Date.now() >= deadline) return resolve(null);
        root.setTimeout(poll, 80);
      }
      poll();
    });
  }

  function isLoading(doc) {
    return Array.from(doc.querySelectorAll('[role="progressbar"], [role="progressindicator"], [aria-busy="true"]')).some(function (node) {
      return !node.closest('[hidden], [aria-hidden="true"]') && doc.defaultView.getComputedStyle(node).display !== 'none';
    });
  }

  /** iCloud 的控件使用按下／抬起事件处理手势，完整派发一次指针序列，不能仅调用 click()。 */
  function activate(button) {
    var view = button.ownerDocument.defaultView;
    var rect = button.getBoundingClientRect();
    var base = { bubbles: true, cancelable: true, view: view, detail: 1, button: 0,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      var Constructor = type.indexOf('pointer') === 0 ? view.PointerEvent : view.MouseEvent;
      if (Constructor) button.dispatchEvent(new Constructor(type, Object.assign({}, base, {
        buttons: type.endsWith('down') ? 1 : 0, pointerId: 1, pointerType: 'mouse', isPrimary: true
      })));
    });
  }

  async function selectList(command) {
    var doc = application();
    if (!doc || command.pageId !== pageId) return result(false, 'STALE_VIEW', '页面已变化，请先刷新列表。');
    var target = listNodes(doc).find(function (node) { return handle(node) === command.listId; });
    if (!target) return result(false, 'STALE_VIEW', '清单已变化，请先刷新列表。');
    if (target.getAttribute('aria-selected') === 'true') return read();
    var oldIds = rowNodes(doc).map(function (row) { return row.id; }).join('|');
    // 点击清单容器，避免在标题按钮上触发重命名编辑。
    activate(target);
    var stable = 0;
    var previous = null;
    var loaded = await until(function () {
      var current = application();
      if (!current || isLoading(current) || target.getAttribute('aria-selected') !== 'true') return false;
      var ids = rowNodes(current).map(function (row) { return row.id; }).join('|');
      if (ids === oldIds && ids) return false;
      stable = previous === ids ? stable + 1 : 0;
      previous = ids;
      return stable >= 3;
    }, 8000);
    if (!loaded) { lastSnapshot = null; return result(false, 'LIST_LOADING', '列表尚未加载完成，请稍后重新读取。'); }
    return read();
  }

  async function setCompleted(command) {
    if (typeof command.completed !== 'boolean' || typeof command.expectedCompleted !== 'boolean') {
      return result(false, 'INVALID_COMMAND', '完成状态必须是明确的布尔值。');
    }
    var doc = application();
    if (!doc || !lastSnapshot || command.pageId !== pageId || lastSnapshot.activeListId !== command.listId) {
      return result(false, 'STALE_VIEW', '这份数据不是当前页面，请先刷新。');
    }
    var active = listNodes(doc).find(function (node) { return node.getAttribute('aria-selected') === 'true'; });
    if (!active || handle(active) !== command.listId) return result(false, 'STALE_VIEW', '当前清单已变化，请先刷新。');
    var rows = rowNodes(doc).filter(function (row) { return row.id === command.id; });
    if (rows.length !== 1) return result(false, 'STALE_VIEW', '无法唯一定位事项，请先刷新。');
    var row = rows[0];
    var current = readItem(row, command.listId);
    if (!current || current.fingerprint !== command.fingerprint || current.completed !== command.expectedCompleted) {
      return result(false, 'STALE_VIEW', '事项已在其他位置变化，请先刷新。');
    }
    if (current.disabled) return result(false, 'READ_ONLY', '网页暂不允许修改这条事项。');
    if (current.completed === command.completed) return result(true, 'UNCHANGED', '事项已经处于目标状态，未再次点击。', { snapshot: lastSnapshot });
    var button = row.querySelector('button.mark-completed[data-completed]');
    activate(button);
    var observed = await until(function () {
      var currentRow = doc.getElementById(command.id);
      var currentButton = currentRow && currentRow.querySelector('button.mark-completed[data-completed]');
      return currentButton && currentButton.getAttribute('data-completed') === String(command.completed);
    }, 6500);
    if (!observed) {
      lastSnapshot = null;
      return result(false, 'UNCERTAIN_WRITE', '操作已发送，但网页未确认结果。请打开官方页面核对，不要重复提交。', { dispatched: true, cloudConfirmed: false });
    }
    var refreshed = read();
    return result(true, 'WEB_STATE_OBSERVED', '网页状态已更新；云端保存仍由 iCloud 处理。', {
      dispatched: true, cloudConfirmed: false, snapshot: refreshed.snapshot || null
    });
  }

  /** 一次只更改一个文字字段；原生编辑命令只执行一次，不以直接改 DOM 的方式回退重试。 */
  async function setText(command) {
    if (!['title', 'notes'].includes(command.field) || typeof command.value !== 'string' ||
        command.value.length > (command.field === 'title' ? 1000 : 2000) ||
        (command.field === 'title' && (!command.value.trim() || /[\r\n]/.test(command.value)))) {
      return result(false, 'INVALID_COMMAND', '标题不能为空，文字长度须在支持范围内。');
    }
    var doc = application();
    if (!doc || !lastSnapshot || command.pageId !== pageId || lastSnapshot.activeListId !== command.listId) {
      return result(false, 'STALE_VIEW', '页面已变化，请先刷新后再编辑。');
    }
    var active = listNodes(doc).find(function (node) { return node.getAttribute('aria-selected') === 'true'; });
    var rows = rowNodes(doc).filter(function (row) { return row.id === command.id; });
    if (!active || handle(active) !== command.listId || rows.length !== 1) return result(false, 'STALE_VIEW', '当前清单或事项已变化，请先刷新。');
    var current = readItem(rows[0], command.listId);
    if (!current || current.fingerprint !== command.fingerprint || current.completed !== command.expectedCompleted) {
      return result(false, 'STALE_VIEW', '事项内容已经变化，请先刷新后再编辑。');
    }
    var editor = rows[0].querySelector('.' + command.field + ' [role="textbox"]');
    if (command.field === 'notes' && current.notesTruncated) {
      return result(false, 'READ_ONLY', '备注较长，请在官方页面查看和编辑完整内容。');
    }
    if (current.disabled || !editor || editor.getAttribute('contenteditable') !== 'true' || editor.getAttribute('aria-readonly') === 'true') {
      return result(false, 'READ_ONLY', '官方页面暂不允许编辑此字段。');
    }
    var expected = command.value.replace(/\r\n?/g, '\n').trim();
    if (current[command.field] === expected) return result(true, 'UNCHANGED', '文字未变化，未再次提交。', { snapshot: lastSnapshot });
    var multiline = /[\r\n]/.test(command.value);
    var nativeCommand = multiline ? 'insertHTML' : 'insertText';
    // 原生多行 insertText 会拆成多个 input，富文本范围无法一次对应；转义后的换行片段只产生一次输入。
    var nativeValue = multiline ? command.value.replace(/\r\n?/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>') : command.value;
    if (typeof doc.execCommand !== 'function' || typeof doc.defaultView.InputEvent !== 'function' ||
        (doc.queryCommandSupported && !doc.queryCommandSupported(nativeCommand))) {
      return result(false, 'EDIT_UNAVAILABLE', '当前网页容器不支持文字编辑，请在官方页面修改。');
    }
    // 与官方界面的点选习惯一致，先进入当前事项和字段的编辑状态，再核对一次内容。
    activate(rows[0]);
    activate(editor.closest('.' + command.field) || editor);
    await new Promise(function (resolve) { root.setTimeout(resolve, 0); });
    var activeRow = doc.getElementById(command.id);
    var afterActivation = activeRow && readItem(activeRow, command.listId);
    if (!afterActivation || afterActivation.fingerprint !== command.fingerprint) return result(false, 'STALE_VIEW', '进入编辑时内容发生变化，请刷新后核对。');
    editor = activeRow.querySelector('.' + command.field + ' [role="textbox"]');
    if (afterActivation.disabled || !editor || editor.getAttribute('contenteditable') !== 'true' || editor.getAttribute('aria-readonly') === 'true') return result(false, 'READ_ONLY', '当前字段暂不可编辑。');
    editor.focus();
    var selection = doc.defaultView.getSelection();
    var range = doc.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    var blurSeen = false;
    var focusOutSeen = false;
    var onBlur = function () { blurSeen = true; };
    var onFocusOut = function () { focusOutSeen = true; };
    editor.addEventListener('blur', onBlur, true);
    editor.addEventListener('focusout', onFocusOut, true);
    var inserted;
    try {
      // Chromium 的 execCommand 不产生 beforeinput；先让网页通过标准事件准备当前选区，再执行一次原生命令。
      var permitted = editor.dispatchEvent(new doc.defaultView.InputEvent('beforeinput', {
        bubbles: true, cancelable: true, composed: true,
        inputType: command.value ? 'insertText' : 'deleteContentBackward', data: command.value || null
      }));
      if (!permitted) {
        lastSnapshot = null;
        return result(false, 'UNCERTAIN_WRITE', '网页接管了文字输入，请先核对结果，不要重复保存。', { dispatched: true, cloudConfirmed: false });
      }
      inserted = doc.execCommand(nativeCommand, false, nativeValue);
      if (inserted) {
        editor.blur();
        // 隐藏容器可以完成原生输入，但不一定产生离开编辑事件。只补齐缺失事件，不重做文字命令。
        if (!blurSeen && !focusOutSeen) {
          editor.dispatchEvent(new doc.defaultView.FocusEvent('blur', { bubbles: false, view: doc.defaultView, relatedTarget: doc.body }));
          editor.dispatchEvent(new doc.defaultView.FocusEvent('focusout', { bubbles: true, view: doc.defaultView, relatedTarget: doc.body }));
        }
      }
    } finally {
      editor.removeEventListener('blur', onBlur, true);
      editor.removeEventListener('focusout', onFocusOut, true);
    }
    var observed = inserted && await until(function () {
      var row = doc.getElementById(command.id);
      var item = row && readItem(row, command.listId);
      return item && item[command.field] === expected;
    }, 6500);
    if (!observed) {
      lastSnapshot = null;
      return result(false, 'UNCERTAIN_WRITE', '编辑已提交，结果尚未确认。请先在官方页面核对，不要重复保存。', { dispatched: true, cloudConfirmed: false });
    }
    var refreshed = read();
    return result(true, 'WEB_STATE_OBSERVED', '网页文字已更新；云端保存仍需核对。', { dispatched: true, cloudConfirmed: false, snapshot: refreshed.snapshot || null });
  }

  root.__suixingAdapter = {
    version: '0.1.8',
    /** 对外仅提供固定命令，不接受任意脚本、接口地址或登录信息。 */
    execute: async function (command) {
      if (inFlight) return result(false, 'BUSY', '上一项操作尚未结束。');
      if (!command || !['read', 'selectList', 'setCompleted', 'setText'].includes(command.type)) return result(false, 'INVALID_COMMAND', '不支持的操作。');
      inFlight = true;
      try {
        if (command.type === 'read') return read();
        if (command.type === 'selectList') return await selectList(command);
        if (command.type === 'setText') return await setText(command);
        return await setCompleted(command);
      } catch (_) {
        lastSnapshot = null;
        return result(false, ['setCompleted', 'setText'].includes(command.type) ? 'UNCERTAIN_WRITE' : 'PAGE_CHANGED', '页面结构已变化，请在官方页面核对后重新读取。', { cloudConfirmed: false });
      } finally { inFlight = false; }
    }
  };
})(window);
