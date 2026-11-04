/* 提醒事项网页共用适配器。只适配已加载页面及当前 DOM 行绑定的日期字段，不接触密码、Cookie 或私有网络接口。 */
(function installSuixingAdapter(root) {
  'use strict';
  if (root.__suixingAdapter && root.__suixingAdapter.version === '0.3.5') return;

  var pageId = 'page-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var listHandles = new WeakMap();
  var nextHandle = 0;
  var inFlight = false;
  var lastSnapshot = null;
  var creationRequests = new Set();
  var creationStage = 'preflight';
  var creationDiagnosticSequence = 0;

  /** 开发诊断只传递固定阶段名；页面退出前也能留下进度，不含任何业务参数或记录标识。 */
  function setCreationStage(stage) {
    creationStage = stage;
    if (root.__suixingDiagnosticPhases === true && Number.isSafeInteger(creationDiagnosticSequence) && creationDiagnosticSequence > 0) {
      try { root.console.info('suixing-create-stage:' + creationDiagnosticSequence + ':' + stage); } catch (_) { /* 日志不可用不改变写入行为。 */ }
    }
  }

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
    var loadedDate = loadedSchedule(row);
    var item = {
      id: row.id,
      title: text(title),
      notes: fullNotes.slice(0, 2000),
      notesTruncated: fullNotes.length > 2000,
      metadata: scheduleMetadata(row,loadedDate).slice(0, 2000),
      metadataPartial: !!(loadedDate && loadedDate.metadataPartial),
      schedule: loadedDate ? loadedDate.schedule : null,
      scheduleFingerprint: loadedDate ? loadedDate.fingerprint : null,
      completed: completed,
      flagged: readFlag(row),
      priority: readPriority(row),
      listId: activeListId,
      level: Number(row.getAttribute('aria-level') || 1),
      disabled: button.disabled || button.getAttribute('aria-disabled') === 'true'
    };
    // 记录 ID 与内容指纹同时匹配，避免同名事项、切换列表或旧缓存导致误操作。
    item.fingerprint = JSON.stringify([item.id, item.title, item.notes, item.metadata, item.completed, activeListId,item.scheduleFingerprint,item.flagged,item.priority]);
    return item;
  }

  /** 只认当前行的独立旗标格；结构未知不当成“没有旗标”。 */
  function readFlag(row) {
    var cells = Array.from(row.querySelectorAll('.flag-container[role="gridcell"]')).filter(function (node) { return !node.closest('.details-popover'); });
    if (cells.length !== 1) return null;
    var children = Array.from(cells[0].children);
    if (children.length > 1 || children.some(function (node) { return !node.matches('.flag'); })) return null;
    return children.length === 1;
  }

  /** 优先级仅取标题前的专用格；空格明确为无，未知结构不猜测。新版网页没有优先级编辑入口。 */
  function readPriority(row) {
    var titles = row.querySelectorAll('.title[role="gridcell"]');
    var cell = titles.length === 1 && titles[0].previousElementSibling;
    if (!cell || cell.getAttribute('role') !== 'gridcell' || cell.closest('.reminder-item[role="row"]') !== row) return null;
    if (Array.from(cell.childNodes).some(function (node) { return node.nodeType === 3 && node.textContent.trim(); })) return null;
    var children = Array.from(cell.children);
    if (!children.length) return 'none';
    if (children.length !== 1 || !children[0].matches('span.priority[data-priority-level]')) return null;
    return {'1':'high','5':'medium','9':'low'}[children[0].getAttribute('data-priority-level')] || null;
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

  /** 只请求官方菜单展开完成项，不切换事项状态；清单变化时不继续点击。 */
  async function showCompleted(command) {
    var doc = application();
    function currentList() {
      var active = doc && listNodes(doc).find(function (node) { return node.getAttribute('aria-selected') === 'true'; });
      return active && handle(active) === command.listId && command.pageId === pageId;
    }
    if (!doc || !lastSnapshot || lastSnapshot.activeListId !== command.listId || !currentList()) return result(false, 'STALE_VIEW', '当前清单已变化，请先刷新。');
    if (isLoading(doc)) return result(false, 'LIST_LOADING', 'iCloud 正在加载列表，请稍后重新读取。');
    function actions() {
      return Array.from(doc.querySelectorAll('[role="menuitem"]')).filter(function (node) {
        return !node.closest('[hidden], [aria-hidden="true"]') && doc.defaultView.getComputedStyle(node).display !== 'none';
      }).map(function (node) { return { node: node, label: node.getAttribute('aria-label') || text(node) }; });
    }
    function completionActions() {
      return actions().filter(function (item) { return /^(?:show\b.*\bcompleted|hide\b.*\bcompleted|显示.*已完成|隐藏.*已完成)/i.test(item.label); });
    }
    var openedHere = false;
    var menuButton = null;
    if (!completionActions().length) {
      var buttons = Array.from(doc.querySelectorAll('.list-detail-button[role="button"]')).filter(function (node) {
        return !node.closest('[hidden], [aria-hidden="true"]');
      });
      if (buttons.length !== 1 || buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') return result(false, 'VIEW_UNAVAILABLE', '请在官方页面显示已完成事项，返回后刷新。');
      menuButton = buttons[0];
      openedHere = true;
      activate(buttons[0]);
    }
    var candidates = await until(function () { var found = completionActions(); return found.length ? found : null; }, 1400);
    if (!currentList()) { lastSnapshot = null; return result(false, 'STALE_VIEW', '打开菜单时清单发生变化，请先刷新。'); }
    if (!candidates || candidates.length !== 1 || candidates[0].node.disabled || candidates[0].node.getAttribute('aria-disabled') === 'true') return result(false, 'VIEW_UNAVAILABLE', '请在官方页面显示已完成事项，返回后刷新。');
    // 已显示时不点击“隐藏”，确保重复请求不会反转界面设置。
    if (/^(?:hide\b|隐藏)/i.test(candidates[0].label)) { if (openedHere) activate(menuButton); return read(); }
    activate(candidates[0].node);
    var stable = 0;
    var previous = null;
    await until(function () {
      if (!currentList()) return true;
      if (isLoading(doc)) { stable = 0; return false; }
      var ids = rowNodes(doc).map(function (row) { return row.id; }).join('|');
      stable = previous === ids ? stable + 1 : 0;
      previous = ids;
      return stable >= 4;
    }, 6500);
    if (!currentList()) { lastSnapshot = null; return result(false, 'STALE_VIEW', '展开期间清单发生变化，请先刷新。'); }
    var refreshed = read();
    if (!refreshed.ok) return refreshed;
    return result(true, 'VIEW_REQUESTED', '已请求显示已完成事项；仍只读取网页当前已加载内容。', { snapshot: refreshed.snapshot });
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

  function textInstruction(value) {
    var multiline = /[\r\n]/.test(value);
    return { command: multiline ? 'insertHTML' : 'insertText', value: multiline ? value.replace(/\r\n?/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>') : value };
  }

  function canReplaceText(doc, value) {
    return typeof doc.execCommand === 'function' && typeof doc.defaultView.InputEvent === 'function' &&
      (!doc.queryCommandSupported || doc.queryCommandSupported(textInstruction(value).command));
  }

  /** 已有字段单次编辑后离开；新事项保留官方自动保存流程。取消或异常绝不改用另一种写法。 */
  async function replaceEditorText(doc, editor, value, settleInitialInput, reportStage) {
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
    try {
      // Chromium 的 execCommand 不产生 beforeinput；网页富文本需要先准备当前选区。
      if (!editor.dispatchEvent(new doc.defaultView.InputEvent('beforeinput', {
        bubbles: true, cancelable: true, composed: true,
        inputType: value ? 'insertText' : 'deleteContentBackward', data: value || null
      }))) { if (reportStage) reportStage('input-cancelled'); return false; }
      var instruction = textInstruction(value);
      // 多行 insertText 会拆成多次 input；仅包含转义文字和换行的片段可一次替换完整范围。
      if (reportStage) reportStage('input-command');
      var inserted = doc.execCommand(instruction.command, false, instruction.value);
      if (inserted) {
        if (reportStage) reportStage('input-accepted');
        // 新记录的文字保存由官方 input 回调排队；让该任务执行，随后继续交给官方自动保存。
        if (settleInitialInput) await new Promise(function (resolve) { root.setTimeout(resolve, 0); });
        if (reportStage) reportStage('input-settled');
        if (!editor.isConnected) { if (reportStage) reportStage('editor-detached'); return false; }
        if (settleInitialInput) { if (reportStage) reportStage('awaiting-autosave'); return true; }
        if (reportStage) reportStage('leaving-editor');
        editor.blur();
        if (!blurSeen && !focusOutSeen) {
          editor.dispatchEvent(new doc.defaultView.FocusEvent('blur', { bubbles: false, view: doc.defaultView, relatedTarget: doc.body }));
          editor.dispatchEvent(new doc.defaultView.FocusEvent('focusout', { bubbles: true, view: doc.defaultView, relatedTarget: doc.body }));
        }
        if (reportStage) reportStage('editor-left');
      } else {
        if (reportStage) reportStage('input-rejected');
      }
      return inserted;
    } finally {
      editor.removeEventListener('blur', onBlur, true);
      editor.removeEventListener('focusout', onFocusOut, true);
    }
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
    if (!canReplaceText(doc, command.value)) {
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
    var inserted = await replaceEditorText(doc, editor, command.value);
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

  /** 新增按钮只激活一次；只向本次新增且唯一的空事项输入标题，不按同名事项判断创建成功。 */
  async function createItem(command) {
    if (typeof command.title !== 'string' || !command.title.trim() || command.title.length > 1000 || /[\r\n]/.test(command.title) ||
        typeof command.requestId !== 'string' || !/^[a-z0-9-]{1,100}$/.test(command.requestId)) return result(false, 'INVALID_COMMAND', '请填写有效的事项标题。');
    if (creationRequests.has(command.requestId)) return result(false, 'ALREADY_SUBMITTED', '本次新增已经提交过，请先读取核对，不要重复创建。');
    var doc = application();
    var active = doc && listNodes(doc).find(function (node) { return node.getAttribute('aria-selected') === 'true'; });
    if (!doc || !lastSnapshot || command.pageId !== pageId || lastSnapshot.activeListId !== command.listId || !active || handle(active) !== command.listId || isLoading(doc)) {
      return result(false, 'STALE_VIEW', '请先读取当前清单，再新增事项。');
    }
    var beforeRows = rowNodes(doc);
    if (beforeRows.some(function (row) { return !text(row.querySelector('.title [role="textbox"]')); })) return result(false, 'DRAFT_OPEN', '官方页面还有空白事项，请先完成或取消它。');
    var buttons = Array.from(doc.querySelectorAll('.rm-new-reminder[role="button"], button.rm-new-reminder'));
    if (buttons.length !== 1 || buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') return result(false, 'READ_ONLY', '当前清单暂不支持新增，请在官方页面核对。');
    // 官方 ui-button 内的原生 button 承担唯一新增回调；直接激活它，避免外围手势再处理同一动作。
    var submitButton = buttons[0].tagName === 'BUTTON' ? buttons[0] : buttons[0].querySelector(':scope > button[type="button"]');
    if (!submitButton || submitButton.disabled) return result(false, 'READ_ONLY', '未取得唯一的新增按钮，请在官方页面核对。');
    if (!canReplaceText(doc, command.title)) return result(false, 'EDIT_UNAVAILABLE', '当前网页容器不支持文字编辑。');
    if (creationRequests.size >= 512) return result(false, 'CREATION_LIMIT', '本次页面的新增操作较多，请重载后再读取。');
    var beforeIds = new Set(beforeRows.map(function (row) { return row.id; }));
    creationRequests.add(command.requestId);
    setCreationStage('waiting-draft');
    submitButton.click();
    var draft = await until(function () {
      var selected = listNodes(doc).find(function (node) { return node.getAttribute('aria-selected') === 'true'; });
      if (!selected || handle(selected) !== command.listId) return false;
      var candidates = rowNodes(doc).filter(function (row) { return !beforeIds.has(row.id); });
      if (candidates.length !== 1) return false;
      // 新节点可能早于本地创建事务结束插入；等待官方 selectForEditing 对它的选择，不能抢先输入并提交。
      if (candidates[0].getAttribute('aria-selected') !== 'true') return false;
      var editor = candidates[0].querySelector('.title [role="textbox"][contenteditable="true"]');
      return editor && !text(editor) && editor.getAttribute('aria-readonly') !== 'true' ? { row: candidates[0], editor: editor } : false;
    }, 6500);
    if (!draft) {
      lastSnapshot = null;
      return result(false, 'UNCERTAIN_WRITE', '新增已发送，尚未取得唯一的新事项，请先在官方页面核对。', { dispatched: true, cloudConfirmed: false, stage: creationStage });
    }
    var id = draft.row.id;
    setCreationStage('writing-title');
    var inserted = await replaceEditorText(doc, draft.editor, command.title, true, setCreationStage);
    if (!inserted) {
      lastSnapshot = null;
      return result(false, 'UNCERTAIN_WRITE', '网页未确认文字输入，请先读取核对，不要重复创建。', { dispatched: true, cloudConfirmed: false, stage: creationStage });
    }
    setCreationStage('observing-title');
    var observed = inserted && await until(function () {
      var row = doc.getElementById(id);
      return row && text(row.querySelector('.title [role="textbox"]')) === command.title.trim();
    }, 6500);
    lastSnapshot = null;
    if (!observed) return result(false, 'UNCERTAIN_WRITE', '新增结果尚未确认，请先读取核对，不要重复创建。', { dispatched: true, cloudConfirmed: false, stage: creationStage });
    setCreationStage('observed');
    var refreshed = read();
    return result(true, 'WEB_STATE_OBSERVED', '新事项已在网页中出现；云端保存仍需核对。', { dispatched: true, cloudConfirmed: false, stage: creationStage, snapshot: refreshed.snapshot || null });
  }

  function validSchedule(value) {
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'date,time,timeZone') return false;
    if (value.date === null) return value.time === null && value.timeZone === null;
    if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return false;
    var parts = value.date.split('-').map(Number), year = parts[0], month = parts[1], day = parts[2];
    var days = [31,year%4 === 0 && (year%100 !== 0 || year%400 === 0) ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month-1]) return false;
    return value.time === null ? value.timeZone === null : typeof value.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time) && typeof value.timeZone === 'string' && /^[A-Za-z0-9_+/-]{1,80}$/.test(value.timeZone);
  }

  /** 仅取这一 DOM 行的直接子组件所绑定的同一记录；不遍历 Fiber、祖先、根状态或其他清单。 */
  function loadedSchedule(row) {
    try {
      var keys = Object.getOwnPropertyNames(row).filter(function (key) { return key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$'); });
      if (keys.length !== 1 || !row.id.startsWith('reminder-item-')) return null;
      var host = row[keys[0]];
      var child = host && host.children;
      if (!child || Array.isArray(child) || typeof child !== 'object') return null;
      var record = child.props && child.props.item;
      if (!record || typeof record.pk !== 'string' || record.pk.length > 1024 || 'reminder-item-'+record.pk !== row.id) return null;
      // 只读取这四个已加载字段，不复制或枚举记录对象。
      var due = record.DueDate, allDay = record.AllDay, zone = record.TimeZone;
      if (zone != null && (typeof zone !== 'string' || !/^[A-Za-z0-9_+/-]{1,80}$/.test(zone))) return null;
      if (allDay != null && typeof allDay !== 'boolean') return null;
      if (zone) new root.Intl.DateTimeFormat('en-US',{timeZone:zone}).format(new root.Date(0));
      var value = {date:null,time:null,timeZone:null};
      if (due != null) {
        if (typeof due !== 'number' || !Number.isFinite(due) || typeof allDay !== 'boolean') return null;
        var date = new root.Date(due);
        if (Number.isNaN(date.getTime())) return null;
        var effectiveZone = allDay ? zone || 'UTC' : editorTimeZone();
        var parts = {};
        new root.Intl.DateTimeFormat('en-US',{timeZone:effectiveZone,calendar:'gregory',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).forEach(function (part) { if (part.type !== 'literal') parts[part.type] = part.value; });
        value.date = padded(Number(parts.year),4)+'-'+parts.month+'-'+parts.day;
        if (!allDay) { value.time = parts.hour+':'+parts.minute; value.timeZone = effectiveZone; }
        if (!validSchedule(value)) return null;
      } else if (row.querySelector('.due-date')) return null;
      return {schedule:value,fingerprint:JSON.stringify([due == null ? null : due,allDay === true,zone || null]),allDay:allDay === true,due:due};
    } catch (_) { return null; }
  }

  /** 纠正已验证的全天日期显示，同时保留可识别的重复文案；不从任意元数据猜测日期。 */
  function scheduleMetadata(row, loaded) {
    var source = row.querySelector('.metadata');
    if (!source || !loaded || !loaded.allDay || !loaded.schedule.date) return text(source);
    var clone = source.cloneNode(true);
    var civil = loaded.schedule.date.split('-').map(Number);
    var canonical = new root.Date(0); canonical.setUTCFullYear(civil[0],civil[1]-1,civil[2]); canonical.setUTCHours(0,0,0,0);
    var locales = [row.ownerDocument.documentElement.lang,root.navigator.language,'zh-CN','en-US','en-GB'].filter(Boolean);
    Array.from(clone.querySelectorAll('.due-date')).forEach(function (node) {
      var display = node.querySelector(':scope > span[aria-hidden]');
      var original = display ? display.textContent.trim() : text(node);
      var replacement = null;
      for (var locale of locales) {
        try {
          var format = new root.Intl.DateTimeFormat(locale,{year:'numeric',month:'numeric',day:'numeric',timeZone:'UTC'});
          var oldLabel = format.format(new root.Date(loaded.due));
          var index = original.indexOf(oldLabel);
          if (index >= 0 && original.lastIndexOf(oldLabel) === index && !/\d/.test(original[index+oldLabel.length] || '')) {
            replacement = original.slice(0,index)+format.format(canonical)+original.slice(index+oldLabel.length); break;
          }
        } catch (_) { /* 不支持的语言交由下一种已知格式核对。 */ }
      }
      // 无法识别网页日期格式时仍显示结构化日期，不把错误的 UTC 日历日当作实际日期。
      if (!replacement && original !== loaded.schedule.date) loaded.metadataPartial = true;
      node.textContent = replacement || loaded.schedule.date;
    });
    return text(clone);
  }

  function itemContext(command) {
    var doc = application();
    if (!doc || !lastSnapshot || command.pageId !== pageId || lastSnapshot.activeListId !== command.listId || typeof command.expectedCompleted !== 'boolean') return null;
    var selected = listNodes(doc).find(function (node) { return node.getAttribute('aria-selected') === 'true'; });
    if (!selected || handle(selected) !== command.listId || isLoading(doc)) return null;
    var rows = rowNodes(doc).filter(function (row) { return row.id === command.id; });
    var item = rows.length === 1 && readItem(rows[0],command.listId);
    if (!item || item.disabled || item.completed !== command.expectedCompleted || item.fingerprint !== command.fingerprint) return null;
    return {doc:doc,row:rows[0],item:item};
  }

  /** 只通过官方详情的语义控件编辑，不访问内部模型、存储或私有网络接口。 */
  async function openItemDetails(context) {
    var doc = context.doc;
    if (doc.querySelector('.details-popover')) return null;
    var buttons = context.row.querySelectorAll('button[data-edit-open][aria-haspopup="dialog"]');
    if (buttons.length !== 1 || buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true') return null;
    var button = buttons[0];
    activate(button);
    return until(function () {
      var panels = doc.querySelectorAll('.reminder-item-details');
      if (!button.isConnected || button.getAttribute('data-edit-open') !== 'true' || panels.length !== 1) return false;
      return {panel:panels[0],popup:panels[0].closest('.details-popover') || panels[0],button:button};
    },1800);
  }

  function detailAction(details, primary) {
    var selector = primary ? 'ui-overlay-actions [role="button"].primary, .info-header [role="button"].primary, button.primary' : 'ui-overlay-actions [role="button"].secondary, .info-header [role="button"].secondary, button.secondary';
    var buttons = Array.from(details.popup.querySelectorAll(selector));
    return buttons.length === 1 && !buttons[0].disabled && buttons[0].getAttribute('aria-disabled') !== 'true' ? buttons[0] : null;
  }

  async function cancelItemDetails(details) {
    if (!details.panel.isConnected) return true;
    var cancel = detailAction(details,false);
    if (!cancel) return false;
    activate(cancel);
    return !!await until(function () { return !details.panel.isConnected; },1000);
  }

  function scheduleSegments(panel, time) {
    var nodes = Array.from(panel.querySelectorAll(time ? '.time-picker .field [role="spinbutton"]' : '.date-field [role="spinbutton"]'));
    var output = {};
    for (var node of nodes) {
      var min = Number(node.getAttribute('aria-valuemin')), max = Number(node.getAttribute('aria-valuemax'));
      var name = time ? min === 0 && max === 59 ? 'minute' : min === 0 && max === 12 ? 'period' : (min === 0 && [11,23].includes(max) || min === 1 && max === 12) ? 'hour' : '' : min === 1 && max === 9999 ? 'year' : min === 1 && max === 12 ? 'month' : min === 1 && max >= 28 && max <= 31 ? 'day' : '';
      if (!name || output[name] || !node.hasAttribute('aria-valuenow') || !/^\d{1,4}$/.test(node.getAttribute('aria-valuenow'))) return null;
      output[name] = node;
    }
    return time ? output.hour && output.minute && nodes.length === (output.period ? 3 : 2) ? output : null : output.year && output.month && output.day && nodes.length === 3 ? output : null;
  }

  function editorTimeZone() { return root.Intl.DateTimeFormat().resolvedOptions().timeZone; }
  function padded(number, length) { return String(number).padStart(length || 2,'0'); }
  function readScheduleDetails(details) {
    var panel = details.panel;
    var enabled = panel.querySelector('#atDate[role="switch"]');
    if (!enabled || !['true','false'].includes(enabled.getAttribute('aria-checked'))) return null;
    if (enabled.getAttribute('aria-checked') === 'false') return {date:null,time:null,timeZone:null};
    var date = scheduleSegments(panel,false);
    var timeSwitch = panel.querySelector('#editTime[role="checkbox"], #editTime[role="switch"]');
    if (!date || !timeSwitch || !['true','false'].includes(timeSwitch.getAttribute('aria-checked'))) return null;
    var value = {date:[padded(Number(date.year.getAttribute('aria-valuenow')),4),padded(Number(date.month.getAttribute('aria-valuenow'))),padded(Number(date.day.getAttribute('aria-valuenow')))].join('-'),time:null,timeZone:null};
    if (timeSwitch.getAttribute('aria-checked') === 'true') {
      var time = scheduleSegments(panel,true);
      if (!time) return null;
      var hour = Number(time.hour.getAttribute('aria-valuenow'));
      if (time.period) hour = hour%12 + (Number(time.period.getAttribute('aria-valuenow')) >= 12 ? 12 : 0);
      value.time = padded(hour)+':'+padded(Number(time.minute.getAttribute('aria-valuenow')));
      value.timeZone = editorTimeZone();
    }
    return validSchedule(value) ? value : null;
  }

  function sameSchedule(first, second) { return first && second && first.date === second.date && first.time === second.time && first.timeZone === second.timeZone; }

  /** 官方全天编辑器可能显示时间戳的 UTC 日历日；仅接受这个已确认的显示差异。 */
  function detailsMatchLoadedSchedule(current, loaded) {
    if (sameSchedule(current,loaded.schedule)) return true;
    if (!current || !loaded.allDay || current.time !== null || current.timeZone !== null) return false;
    var date = new root.Date(loaded.due);
    var utcDate = padded(date.getUTCFullYear(),4)+'-'+padded(date.getUTCMonth()+1)+'-'+padded(date.getUTCDate());
    return current.date === utcDate;
  }

  async function getSchedule(command) {
    var context = itemContext(command);
    if (!context) return result(false,'STALE_VIEW','事项已变化，请先刷新。');
    var loaded = loadedSchedule(context.row);
    if (!loaded) return result(false,'SCHEDULE_UNAVAILABLE','暂不能安全读取日期，请在官方页面查看。');
    var refreshed = read();
    return result(true,'READY','已读取日期。',{snapshot:refreshed.snapshot,schedule:loaded.schedule,scheduleFingerprint:loaded.fingerprint,editorTimeZone:editorTimeZone()});
  }

  async function fillScheduleSegment(details, time, name, number, endpoint) {
    var fields = scheduleSegments(details.panel,time);
    var node = fields && fields[name];
    if (!node || node.getAttribute('aria-disabled') === 'true' || node.getAttribute('aria-readonly') === 'true' || node.getAttribute('contenteditable') !== 'true') return false;
    if (Number(node.getAttribute('aria-valuenow')) === number) return true;
    node.focus();
    if (endpoint) {
      node.dispatchEvent(new node.ownerDocument.defaultView.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:endpoint}));
    } else {
      // 官方分段编辑器主动接管 beforeinput；不改 textContent，不回退到另一种输入方式。
      node.dispatchEvent(new node.ownerDocument.defaultView.InputEvent('beforeinput',{bubbles:true,cancelable:true,composed:true,inputType:'insertText',data:String(number)}));
    }
    return !!await until(function () { var current = scheduleSegments(details.panel,time); return current && Number(current[name].getAttribute('aria-valuenow')) === number; },900);
  }

  async function fillScheduleDraft(details, value) {
    var panel = details.panel;
    var dateSwitch = panel.querySelector('#atDate[role="switch"]');
    if (!dateSwitch || dateSwitch.getAttribute('aria-disabled') === 'true') return false;
    var enabled = value.date !== null;
    if (dateSwitch.getAttribute('aria-checked') !== String(enabled)) activate(dateSwitch);
    if (!await until(function () { var current = panel.querySelector('#atDate[role="switch"]'); return current && current.getAttribute('aria-checked') === String(enabled); },900)) return false;
    if (!enabled) return true;
    if (!await until(function () { return scheduleSegments(panel,false); },900)) return false;
    var timeSwitch = panel.querySelector('#editTime[role="checkbox"], #editTime[role="switch"]');
    if (!timeSwitch || timeSwitch.getAttribute('aria-disabled') === 'true') return false;
    var timed = value.time !== null;
    if (timeSwitch.getAttribute('aria-checked') !== String(timed)) activate(timeSwitch);
    if (!await until(function () { var current = panel.querySelector('#editTime[role="checkbox"], #editTime[role="switch"]'); return current && current.getAttribute('aria-checked') === String(timed); },900)) return false;
    var parts = value.date.split('-').map(Number);
    for (var index = 0; index < 3; index++) if (!await fillScheduleSegment(details,false,['year','month','day'][index],parts[index])) return false;
    if (timed) {
      var fields = await until(function () { return scheduleSegments(panel,true); },900);
      if (!fields) return false;
      var clock = value.time.split(':').map(Number);
      if (fields.period && !await fillScheduleSegment(details,true,'period',clock[0] >= 12 ? 12 : 0,clock[0] >= 12 ? 'End' : 'Home')) return false;
      if (!await fillScheduleSegment(details,true,'hour',fields.period ? clock[0]%12 || 12 : clock[0]) || !await fillScheduleSegment(details,true,'minute',clock[1])) return false;
    }
    return sameSchedule(readScheduleDetails(details),value);
  }

  async function setSchedule(command) {
    if (!validSchedule(command.value) || !validSchedule(command.expectedSchedule) || typeof command.expectedScheduleFingerprint !== 'string' || command.expectedScheduleFingerprint.length > 200) return result(false,'INVALID_COMMAND','日期或时间格式不正确。');
    if (command.value.time !== null && command.value.timeZone !== editorTimeZone()) return result(false,'STALE_VIEW','系统时区已变化，请重新读取日期。');
    var context = itemContext(command);
    if (!context) return result(false,'STALE_VIEW','事项已变化，请先刷新。');
    var loaded = loadedSchedule(context.row);
    if (!loaded) return result(false,'SCHEDULE_UNAVAILABLE','暂不能安全读取日期，请在官方页面编辑。');
    if (loaded.fingerprint !== command.expectedScheduleFingerprint || !sameSchedule(loaded.schedule,command.expectedSchedule)) return result(false,'STALE_VIEW','日期已变化，请重新读取。');
    if (sameSchedule(loaded.schedule,command.value)) return result(true,'UNCHANGED','日期已经处于目标状态，未再次存储。',{snapshot:read().snapshot,dispatched:false,cloudConfirmed:false});
    var details = await openItemDetails(context);
    if (!details) return result(false,'EDIT_UNAVAILABLE','请先关闭官方页面中已有的编辑窗口，再刷新。');
    var current = readScheduleDetails(details);
    var save = detailAction(details,true);
    if (!current || !save || details.panel.querySelector('.repeat-info')) {
      await cancelItemDetails(details); lastSnapshot = null;
      return result(false,'SCHEDULE_UNAVAILABLE','当前事项需要在官方页面编辑日期。');
    }
    if (!detailsMatchLoadedSchedule(current,loaded)) {
      await cancelItemDetails(details); lastSnapshot = null;
      return result(false,'SCHEDULE_UNAVAILABLE','官方日期与当前读取不一致，请在官方页面核对。',{dispatched:false,cloudConfirmed:false});
    }
    if (!await fillScheduleDraft(details,command.value) || !itemContext(command)) {
      await cancelItemDetails(details); lastSnapshot = null;
      return result(false,'UNCERTAIN_WRITE','日期草稿未通过核对，请先刷新；不要重复保存。',{dispatched:true,cloudConfirmed:false});
    }
    save = detailAction(details,true);
    if (!save) { await cancelItemDetails(details); lastSnapshot = null; return result(false,'UNCERTAIN_WRITE','存储控件已变化，请先读取核对。',{dispatched:true,cloudConfirmed:false}); }
    activate(save);
    lastSnapshot = null;
    if (!await until(function () { return !details.panel.isConnected; },1800)) return result(false,'UNCERTAIN_WRITE','日期存储结果尚未确认，请在官方页面核对。',{dispatched:true,cloudConfirmed:false});
    var row = context.doc.getElementById(command.id);
    if (!row || !rowNodes(context.doc).includes(row)) return result(false,'UNCERTAIN_WRITE','事项已离开当前视图，请先读取核对。',{dispatched:true,cloudConfirmed:false});
    var observed = await until(function () { var currentRow = context.doc.getElementById(command.id); var currentDate = currentRow && loadedSchedule(currentRow); return currentDate && sameSchedule(currentDate.schedule,command.value) ? currentDate : false; },1800);
    var refreshed = read();
    if (!observed || !refreshed.ok) return result(false,'UNCERTAIN_WRITE','网页尚未确认目标日期，请先读取核对。',{dispatched:true,cloudConfirmed:false});
    return result(true,'WEB_STATE_OBSERVED','网页日期已更新；云端保存仍需核对。',{snapshot:refreshed.snapshot,dispatched:true,cloudConfirmed:false});
  }

  async function setFlagged(command) {
    if (typeof command.flagged !== 'boolean' || typeof command.expectedFlagged !== 'boolean') return result(false,'INVALID_COMMAND','请提交明确的旗标状态。');
    var context = itemContext(command);
    if (!context) return result(false,'STALE_VIEW','事项已变化，请先刷新。');
    if (typeof context.item.flagged !== 'boolean') return result(false,'FLAG_UNAVAILABLE','暂不能安全读取旗标，请在官方页面查看。');
    if (context.item.flagged !== command.expectedFlagged) return result(false,'STALE_VIEW','旗标已变化，请重新读取。');
    if (context.item.flagged === command.flagged) return result(true,'UNCHANGED','旗标已经处于目标状态，未再次存储。',{snapshot:read().snapshot,dispatched:false,cloudConfirmed:false});
    var details = await openItemDetails(context);
    if (!details) return result(false,'EDIT_UNAVAILABLE','请先关闭官方页面已有的编辑窗口，再刷新。');
    var buttons = details.panel.querySelectorAll('button.flag-edit-button[aria-pressed]');
    var toggle = buttons.length === 1 && buttons[0];
    var save = detailAction(details,true);
    if (!toggle || toggle.disabled || toggle.getAttribute('aria-disabled') === 'true' || !['true','false'].includes(toggle.getAttribute('aria-pressed')) || !save || details.panel.querySelector('.repeat-info')) {
      await cancelItemDetails(details);lastSnapshot = null;
      return result(false,'FLAG_UNAVAILABLE','当前事项需要在官方页面编辑旗标。',{dispatched:false,cloudConfirmed:false});
    }
    if ((toggle.getAttribute('aria-pressed') === 'true') !== command.expectedFlagged) {
      await cancelItemDetails(details);lastSnapshot = null;
      return result(false,'STALE_VIEW','官方详情的旗标已变化，请重新核对。',{dispatched:false,cloudConfirmed:false});
    }
    activate(toggle);
    if (!await until(function () { return toggle.isConnected && toggle.getAttribute('aria-pressed') === String(command.flagged); },900) || !itemContext(command)) {
      await cancelItemDetails(details);lastSnapshot = null;
      return result(false,'UNCERTAIN_WRITE','旗标草稿尚未确认，请先读取核对，不要重复提交。',{dispatched:true,cloudConfirmed:false});
    }
    save = detailAction(details,true);
    if (!save) { await cancelItemDetails(details);lastSnapshot = null;return result(false,'UNCERTAIN_WRITE','存储控件已变化，请先读取核对。',{dispatched:true,cloudConfirmed:false}); }
    activate(save);lastSnapshot = null;
    var closed = await until(function () { return !details.panel.isConnected; },1800);
    var observed = closed && await until(function () { var row = context.doc.getElementById(command.id);return row && rowNodes(context.doc).includes(row) && readFlag(row) === command.flagged; },1800);
    var refreshed = read();
    if (!observed || !refreshed.ok) return result(false,'UNCERTAIN_WRITE','网页尚未确认目标旗标，请先读取核对。',{dispatched:true,cloudConfirmed:false});
    return result(true,'WEB_STATE_OBSERVED','网页旗标已更新；云端保存仍需核对。',{snapshot:refreshed.snapshot,dispatched:true,cloudConfirmed:false});
  }

  root.__suixingAdapter = {
    version: '0.3.5',
    /** 对外仅提供固定命令，不接受任意脚本、接口地址或登录信息。 */
    execute: async function (command) {
      if (inFlight) return result(false, 'BUSY', '上一项操作尚未结束。');
      if (!command || !['read', 'selectList', 'showCompleted', 'getSchedule', 'setSchedule', 'setFlagged', 'setCompleted', 'setText', 'createItem'].includes(command.type)) return result(false, 'INVALID_COMMAND', '不支持的操作。');
      inFlight = true;
      if (command.type === 'createItem') { creationDiagnosticSequence = root.__suixingDiagnosticWriteSequence; setCreationStage('preflight'); }
      try {
        if (command.type === 'read') return read();
        if (command.type === 'selectList') return await selectList(command);
        if (command.type === 'showCompleted') return await showCompleted(command);
        if (command.type === 'getSchedule') return await getSchedule(command);
        if (command.type === 'setSchedule') return await setSchedule(command);
        if (command.type === 'setFlagged') return await setFlagged(command);
        if (command.type === 'setText') return await setText(command);
        if (command.type === 'createItem') return await createItem(command);
        return await setCompleted(command);
      } catch (_) {
        lastSnapshot = null;
        return result(false, ['setCompleted', 'setText', 'createItem', 'setSchedule', 'setFlagged'].includes(command.type) ? 'UNCERTAIN_WRITE' : 'PAGE_CHANGED', '页面结构已变化，请在官方页面核对后重新读取。', { cloudConfirmed: false, stage: command.type === 'createItem' ? creationStage : undefined });
      } finally { inFlight = false; }
    }
  };
})(window);
