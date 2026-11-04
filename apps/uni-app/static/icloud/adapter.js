/* 提醒事项网页共用适配器。仅访问页面 DOM，不接触密码、Cookie 或私有网络接口。 */
(function installSuixingAdapter(root) {
  'use strict';
  if (root.__suixingAdapter && root.__suixingAdapter.version === '0.1.2') return;

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
    var item = {
      id: row.id,
      title: text(title),
      notes: text(row.querySelector('.notes [role="textbox"]')).slice(0, 2000),
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

  root.__suixingAdapter = {
    version: '0.1.2',
    /** 对外仅提供固定命令，不接受任意脚本、接口地址或登录信息。 */
    execute: async function (command) {
      if (inFlight) return result(false, 'BUSY', '上一项操作尚未结束。');
      if (!command || !['read', 'selectList', 'setCompleted'].includes(command.type)) return result(false, 'INVALID_COMMAND', '不支持的操作。');
      inFlight = true;
      try {
        if (command.type === 'read') return read();
        if (command.type === 'selectList') return await selectList(command);
        return await setCompleted(command);
      } catch (_) {
        lastSnapshot = null;
        return result(false, command.type === 'setCompleted' ? 'UNCERTAIN_WRITE' : 'PAGE_CHANGED', '页面结构已变化，请在官方页面核对后重新读取。', { cloudConfirmed: false });
      } finally { inFlight = false; }
    }
  };
})(window);
