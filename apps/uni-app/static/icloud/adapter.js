/* 提醒事项网页共用适配器。只适配已加载页面及当前 DOM 行绑定的日期字段，不接触密码、Cookie 或私有网络接口。 */
(function installSuixingAdapter(root) {
  'use strict';
  if (root.__suixingAdapter && root.__suixingAdapter.version === '0.3.26') return;
  if (root.__suixingAdapter && typeof root.__suixingAdapter.dispose === 'function') root.__suixingAdapter.dispose();

  var pageId = 'page-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var listHandles = new WeakMap();
  var nextHandle = 0;
  var inFlight = false;
  var lastSnapshot = null;
  var compactSelection = null;
  var compactLists = null;
  var creationRequests = new Set();
  var deletionRequests = new Set();
  var listRequests = new Set();
  var hierarchyRequests = new Set();
  var detailScheduleReads = new Map();
  var connectionEpoch = 0;
  var operationEpoch = 0;
  var settledCreation = null;
  function clearSettledCreation() {
    if(settledCreation) ['beforeinput','input','compositionstart'].forEach(function(type){settledCreation.row.removeEventListener(type,clearSettledCreation,true);});
    settledCreation=null;
  }
  function rememberSettledCreation(doc,id,title,listId) {
    clearSettledCreation();
    var row=doc.getElementById(id),editor=row && row.querySelector('.title [role="textbox"]');
    if(!row || !editor || doc.activeElement!==editor || text(editor)!==title)return;
    settledCreation={row:row,editor:editor,id:id,title:title,listId:listId,epoch:connectionEpoch};
    ['beforeinput','input','compositionstart'].forEach(function(type){row.addEventListener(type,clearSettledCreation,true);});
  }
  function lostConnection() {
    clearSettledCreation();
    connectionEpoch++;
    pageId='page-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    lastSnapshot=null;compactSelection=null;compactLists=null;detailScheduleReads.clear();
  }
  root.addEventListener('offline',lostConnection);
  function assertConnected() {
    if (root.navigator.onLine===false || inFlight && operationEpoch!==connectionEpoch) throw new Error('SUIXING_OFFLINE');
  }
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
    assertConnected();
    return documents().find(function (doc) {
      return doc.querySelector('[role="tree"] .rm-list-menu-item') ||
        doc.querySelector('[role="treegrid"] .reminder-item') ||
        doc.querySelector('.no-lists-note') && doc.querySelector('.new-list-button') || compactPane(doc) ||
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

  function compactPane(doc) {
    return doc.querySelector('.rm-list .rm-list-header.compact .list-back-button')?.closest('.rm-list') || null;
  }

  function compactTitle(pane) {
    return text(pane?.querySelector('.rm-list-header h1.title .inline-editable-label'));
  }

  function selectedListNode(doc) {
    var current = listNodes(doc).find(function (node) { return node.getAttribute('aria-selected') === 'true'; });
    if (current) return current;
    var selection = compactSelection;
    if (selection && selection.pane === compactPane(doc) && compactTitle(selection.pane) === listName(selection.node)) return selection.node;
    return null;
  }

  /** 手机官网一次只挂载清单导航或事项页。仅点击明确的“列表”返回按钮，不碰编辑或确认弹层。 */
  async function revealCompactLists(doc) {
    var deferred = deferredWhileEditing(doc);
    if (deferred) return deferred;
    var back = compactPane(doc)?.querySelector('.list-back-button');
    if (!back || !visibleControl(back) || back.disabled || back.getAttribute('aria-disabled') === 'true') {
      return result(false, 'LIST_LOADING', '官方清单导航尚未就绪，请稍后刷新。');
    }
    activate(back);
    var navigation = await until(function () {
      var current = application();
      return current && !isLoading(current) && !compactPane(current) &&
        (listNodes(current).length || current.querySelector('.no-lists-note') && current.querySelector('.new-list-button')) && current;
    }, 4000);
    if (!navigation) return result(false, 'LIST_LOADING', '官方清单导航尚未就绪，请稍后刷新。');
    compactSelection = null;
    return navigation;
  }

  function handle(node) {
    if (!listHandles.has(node)) listHandles.set(node, 'list-' + (++nextHandle));
    return listHandles.get(node);
  }

  function listName(node) { return text(node && node.querySelector('.inline-editable-label')); }

  /** 图标只投影静态几何与本地蒙版引用；不复制 HTML、脚本、样式、外链或事件属性。 */
  function listIcon(svg) {
    if(!svg || svg.tagName.toLowerCase()!=='svg' || svg.getAttribute('viewBox')!=='0 0 64 64')return null;
    var nodes=[svg].concat(Array.from(svg.querySelectorAll('*'))),ids=new Map(),failed=false;
    if(nodes.length>100)return null;
    nodes.forEach(function(node){var id=node.getAttribute('id');if(id){if(!/^[\w-]{1,80}$/.test(id) || ids.has(id))failed=true;else ids.set(id,'shape-'+ids.size);}});
    var numeric=/^[\d+.,\sEe-]{1,100}$/;
    function project(node) {
      var tag=node.tagName.toLowerCase(),attributes=[],allowed={svg:['viewBox','xmlns','xmlns:xlink'],path:['d','fill','fill-rule','clip-rule','id','transform'],g:['fill','fill-rule','clip-rule','id','transform','mask'],circle:['cx','cy','r','fill','id','transform'],defs:[],mask:['id','fill'],use:['href','xlink:href','fill','transform','mask']}[tag];
      if(!allowed)throw Error('unknown-geometry');
      if(!['svg','defs'].includes(tag))allowed=allowed.concat(['fill-rule','clip-rule','mask']);
      Array.from(node.attributes).forEach(function(attr){
        var name=attr.name,value=attr.value;
        if(node===svg && ['class','style'].includes(name))return;
        if(!allowed.includes(name))throw Error('unknown-attribute');
        if(name==='xmlns' || name==='xmlns:xlink')return;
        if(name==='viewBox'){if(node!==svg || value!=='0 0 64 64')throw Error('unknown-viewbox');}
        else if(name==='id')value=ids.get(value);
        else if(name==='href' || name==='xlink:href'){if(value[0]!=='#' || !ids.has(value.slice(1)))throw Error('external-reference');value='#'+ids.get(value.slice(1));name='href';}
        else if(name==='mask'){var match=/^url\(#([\w-]+)\)$/.exec(value);if(!match || !ids.has(match[1]))throw Error('external-mask');value='url(#'+ids.get(match[1])+')';}
        else if(name==='d'){if(!/^[MmZzLlHhVvCcSsQqTtAa\d.,+\sEe-]{1,30000}$/.test(value))throw Error('unknown-path');}
        else if(name==='fill'){if(!/^(none|black|white|currentColor|#[0-9a-f]{3}|#[0-9a-f]{6})$/i.test(value))throw Error('unknown-fill');}
        else if(name==='fill-rule' || name==='clip-rule'){if(!/^(nonzero|evenodd)$/.test(value))throw Error('unknown-rule');}
        else if(name==='transform'){if(!/^(?:(?:translate|scale|rotate|matrix|skewX|skewY)\([\d+.,\sEe-]+\)\s*){1,8}$/.test(value))throw Error('unknown-transform');}
        else if(!numeric.test(value))throw Error('unknown-number');
        attributes.push([name,value]);
      });
      if(Array.from(node.childNodes).some(function(child){return child.nodeType!==1 && child.textContent.trim();}))throw Error('unknown-content');
      attributes.sort(function(a,b){return a[0].localeCompare(b[0]);});
      return '<'+tag+attributes.map(function(attr){return ' '+attr[0]+'="'+attr[1]+'"';}).join('')+'>'+Array.from(node.children).map(project).join('')+'</'+tag+'>';
    }
    try {
      if(failed)return null;
      var geometry=project(svg);if(geometry.length>60000)return null;
      var a=2166136261,b=2246822519;for(var i=0;i<geometry.length;i++){a=Math.imul(a^geometry.charCodeAt(i),16777619);b=Math.imul(b^geometry.charCodeAt(i),3266489917);}
      return {key:'shape-'+(a>>>0).toString(16)+'-'+(b>>>0).toString(16)+'-'+geometry.length,svg:geometry};
    }catch(_){return null;}
  }

  function readList(node) {
    var icon=node.querySelector('.reminder-list-icon');
    var geometry=listIcon(icon);
    var list={id:handle(node),title:listName(node),selected:node.getAttribute('aria-selected')==='true',color:icon && icon.style.backgroundColor || '#1687ff',icon:geometry};
    list.fingerprint=JSON.stringify([list.id,list.title,list.color,geometry && geometry.key]);
    return list;
  }

  /** 删除后只返回清单导航，不自动读取官方页面可能选中的另一份事项内容。 */
  function navigationSnapshot(doc,lists) {
    var snapshot={pageId:pageId,capturedAt:new Date().toISOString(),lists:lists.map(function(list){return Object.assign({},list,{selected:false});}),activeListId:null,activeListTitle:'',items:[],loadedCount:0,expectedCount:0,partial:false,
      emptyAccount:lists.length===0 && !!doc.querySelector('.no-lists-note') && !!doc.querySelector('.new-list-button'),coverage:'请选择清单后读取网页已加载内容',source:'icloud-web-dom'};
    lastSnapshot=snapshot;return snapshot;
  }

  /** 自动交接和读取共用官方编辑保护，保留焦点和草稿。 */
  function deferredWhileEditing(doc, preservedCreation) {
    var focused=doc.activeElement;
    var editing=focused && focused.closest('[contenteditable="true"],input,textarea') && !preservedCreation;
    var panels=Array.from(doc.querySelectorAll('.reminder-list-detail,.details-popover,[role="dialog"],[role="alertdialog"],[role="menu"]')).some(visibleControl);
    var markers=Array.from(doc.querySelectorAll('[data-edit="true"]')).some(function(node){
      return visibleControl(node) && !(preservedCreation && (node===preservedCreation.row || preservedCreation.row.contains(node) && node.contains(preservedCreation.editor)));
    });
    if(editing || panels || markers)return result(false,'AUTO_READ_DEFERRED','正在官方页面编辑，自动读取暂缓。',{
      reason:editing?'focused-field':panels?'open-panel':'active-marker'
    });
  }

  async function readLists(command) {
    var doc=application();
    if(!doc || isLoading(doc)) {
      lastSnapshot=null;
      var login=command.sessionProbe && documents().some(function(page) {
        return Array.from(page.querySelectorAll('button,a,[role="button"]')).some(function(node) {
          return visibleControl(node) && /^(sign in|登录|登入)$/i.test(text(node));
        }) || !!page.querySelector('iframe[src*="idmsa.apple.com"]');
      });
      return result(false,login?'LOGIN_REQUIRED':'PAGE_NOT_READY',login?'请在官方页面重新登录。':'官方清单尚未就绪，请稍后读取。');
    }
    if(command.background===true) {
      var deferred=deferredWhileEditing(doc);
      if(deferred)return deferred;
    }
    if (command.androidCompact && command.background && compactPane(doc) && selectedListNode(doc)) {
      // 手机官网选中清单时卸载导航。汇总先核对当前事项页绑定，保留选区供恢复使用。
      return result(true,'SELECT_A_LIST','请选择清单后继续。',{
        snapshot:navigationSnapshot(doc,compactLists),needsListSelection:true,selectedListId:handle(compactSelection.node)
      });
    }
    if (command.androidCompact && !listNodes(doc).length && compactPane(doc)) {
      var navigation = await revealCompactLists(doc);
      if (navigation.ok === false) return navigation;
      doc = navigation;
    }
    var lists=listNodes(doc).map(readList);
    if (command.androidCompact && !lists.length && !(doc.querySelector('.no-lists-note') && doc.querySelector('.new-list-button'))) {
      return result(false, 'LIST_LOADING', '官方清单导航尚未就绪，请稍后刷新。');
    }
    if (command.androidCompact) compactLists = lists;
    var navigation={snapshot:navigationSnapshot(doc,lists),needsListSelection:true};
    if(command.background===true) {
      var selected=lists.filter(function(list){return list.selected;});
      // 空字符串表示确认无选区，null 表示选区不唯一，后者不能作为后台切换起点。
      navigation.selectedListId=selected.length===1?selected[0].id:selected.length===0?'':null;
    }
    return result(true,'SELECT_A_LIST','请选择清单后继续。',navigation);
  }

  /** 等待指定清单时先核对页面和官方选区，不能读取自动改选的其他事项。 */
  function readSelectedList(command) {
    if(typeof command.pageId!=='string' || !command.pageId || typeof command.listId!=='string' || !command.listId)return result(false,'INVALID_COMMAND','请指定要读取的清单。');
    if(command.background!==undefined && typeof command.background!=='boolean')return result(false,'INVALID_COMMAND','自动读取参数无效。');
    if(command.pageId!==pageId){lastSnapshot=null;return result(false,'STALE_VIEW','页面已变化，请重新选择清单。');}
    var doc=application();
    if(!doc || isLoading(doc)){lastSnapshot=null;return result(false,'LIST_LOADING','指定清单正在加载，请稍后读取。');}
    var selected=listNodes(doc).filter(function(node){return node.getAttribute('aria-selected')==='true';});
    if (!selected.length && command.androidCompact && selectedListNode(doc)) selected.push(selectedListNode(doc));
    if(selected.length!==1 || handle(selected[0])!==command.listId){lastSnapshot=null;return result(false,'STALE_VIEW','官方选中的清单已变化，请重新选择。');}
    // 自动读取不碰官方编辑草稿或弹层，也不通过失焦结束编辑。
    if(command.background===true) {
      var focused=doc.activeElement;
      // 新增成功后保留官方输入焦点；只放行本次已观察且未再次输入的同一字段。
      var known=command.reload!==true && settledCreation && settledCreation.epoch===connectionEpoch && settledCreation.listId===command.listId && settledCreation.row.isConnected && settledCreation.editor.isConnected &&
        doc.getElementById(settledCreation.id)===settledCreation.row && focused===settledCreation.editor && text(focused)===settledCreation.title;
      var deferred=deferredWhileEditing(doc,known && settledCreation);
      if(deferred)return deferred;
    }
    return read(command);
  }

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
      parentId: rowParent(row).id,
      hierarchyReadable: rowParent(row).readable,
      disabled: button.disabled || button.getAttribute('aria-disabled') === 'true'
    };
    // 记录 ID 与内容指纹同时匹配，避免同名事项、切换列表或旧缓存导致误操作。
    item.fingerprint = JSON.stringify([item.id, item.title, item.notes, item.metadata, item.completed, activeListId,item.scheduleFingerprint,item.flagged,item.priority,item.level,row.getAttribute('aria-expanded'),item.parentId,item.hierarchyReadable]);
    return item;
  }

  /** 网页只暴露两级事项；从同一行组的前序主事项识别父项，不读取内部父记录字段。 */
  function rowParent(row) {
    var level=Number(row.getAttribute('aria-level') || 1);
    if(level===1)return {id:null,readable:true};
    if(level!==2)return {id:null,readable:false};
    var previous=row.previousElementSibling,steps=0;
    while(previous && steps++<2000){
      if(previous.matches('.reminder-item[role="row"][id]')){
        var prior=Number(previous.getAttribute('aria-level'));
        if(prior===1)return {id:previous.id,readable:true};
        if(prior!==2)return {id:null,readable:false};
      }
      previous=previous.previousElementSibling;
    }
    return {id:null,readable:false};
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

  function read(command) {
    var doc = application();
    if (!doc) {
      lastSnapshot = null;
      return result(false, 'PAGE_NOT_READY', '暂时读不到官方清单。请在 iCloud 官方页面确认清单已显示后再刷新。');
    }
    if (isLoading(doc)) {
      lastSnapshot = null;
      return result(false, 'LIST_LOADING', 'iCloud 正在加载列表，请稍后重新读取。');
    }
    var nodes = listNodes(doc);
    var lists = nodes.map(readList);
    var active = lists.find(function (item) { return item.selected; });
    if (!nodes.length && compactPane(doc) && (command?.androidCompact || compactSelection)) {
      var selected = selectedListNode(doc);
      if (!selected) return readLists({ androidCompact: true, background: true });
      active = readList(selected);
      active.selected = true;
      lists = compactLists.map(function (list) { return Object.assign({}, list, {selected:list.id === active.id}); });
    }
    if (!active) {
      return result(true,'SELECT_A_LIST',lists.length?'请选择一个清单。':'还没有清单，可以新建一份。',{snapshot:navigationSnapshot(doc,lists),needsListSelection:true});
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
    return new Promise(function (resolve,reject) {
      function poll() {
        try {
          assertConnected();
          var value = predicate();
          if (value) return resolve(value);
          if (Date.now() >= deadline) return resolve(null);
          root.setTimeout(poll, 80);
        } catch(error) { reject(error); }
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
    assertConnected();
    var view = button.ownerDocument.defaultView;
    var rect = button.getBoundingClientRect();
    var base = { bubbles: true, cancelable: true, view: view, detail: 1, button: 0,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      assertConnected();
      var Constructor = type.indexOf('pointer') === 0 ? view.PointerEvent : view.MouseEvent;
      if (Constructor) button.dispatchEvent(new Constructor(type, Object.assign({}, base, {
        buttons: type.endsWith('down') ? 1 : 0, pointerId: 1, pointerType: 'mouse', isPrimary: true
      })));
    });
  }

  async function selectList(command) {
    var doc = application();
    if (!doc || command.pageId !== pageId) return result(false, 'STALE_VIEW', '页面已变化，请先刷新列表。');
    var requested = null;
    var checkedCompactSource = false;
    if (command.androidCompact && compactPane(doc)) {
      var selected = selectedListNode(doc);
      if (command.background && (!selected || handle(selected) !== command.fromListId || isLoading(doc))) {
        return result(false,'STALE_VIEW','官方选区已变化，请刷新清单。');
      }
      checkedCompactSource = command.background === true;
      if (selected && handle(selected) === command.listId) return read(command);
      requested = compactLists?.find(function (list) { return list.id === command.listId; });
      if (!requested || compactLists.filter(function (list) { return list.title === requested.title; }).length !== 1) {
        return result(false, 'STALE_VIEW', '请刷新清单导航后重新选择。');
      }
      var navigation = await revealCompactLists(doc);
      if (navigation.ok === false) return navigation;
      doc = navigation;
    }
    var nodes = listNodes(doc);
    if(command.background===true) {
      var selected=nodes.filter(function(node){return node.getAttribute('aria-selected')==='true';});
      var previousId=selected.length===1?handle(selected[0]):selected.length===0?'':null;
      var expectedSource = checkedCompactSource ? '' : command.fromListId;
      if(isLoading(doc) || typeof expectedSource!=='string' || previousId!==expectedSource)return result(false,'STALE_VIEW','官方选区已变化，请刷新清单。');
      var deferred=deferredWhileEditing(doc);
      if(deferred)return deferred;
    }
    var target;
    if (requested) {
      var matches = nodes.filter(function (node) { return listName(node) === requested.title; });
      if (matches.length === 1 && nodes.length === compactLists.length &&
          nodes.every(function (node, index) { return listName(node) === compactLists[index].title; })) {
        nodes.forEach(function (node, index) { listHandles.set(node, compactLists[index].id); });
        target = matches[0];
      }
    } else target = nodes.find(function (node) { return handle(node) === command.listId; });
    if (!target) return result(false, 'STALE_VIEW', '清单已变化，请先刷新列表。');
    if (target.getAttribute('aria-selected') === 'true') return read(command);
    if (command.androidCompact) compactLists = nodes.map(readList);
    var oldIds = rowNodes(doc).map(function (row) { return row.id; }).join('|');
    // 点击清单容器，避免在标题按钮上触发重命名编辑。
    activate(target);
    var stable = 0;
    var previous = null;
    var loaded = await until(function () {
      var current = application();
      if (!current || isLoading(current)) return false;
      var pane = command.androidCompact && compactPane(current);
      var compactReady = pane && !target.isConnected && compactTitle(pane) === listName(target);
      if (!compactReady && target.getAttribute('aria-selected') !== 'true') return false;
      var ids = rowNodes(current).map(function (row) { return row.id; }).join('|');
      if (ids === oldIds && ids) return false;
      stable = previous === ids ? stable + 1 : 0;
      previous = ids;
      return stable >= 3 && (compactReady ? pane : true);
    }, 8000);
    if (!loaded) { lastSnapshot = null; return result(false, 'LIST_LOADING', '列表尚未加载完成，请稍后重新读取。'); }
    if (loaded !== true) compactSelection = {pane:loaded,node:target};
    if(command.background===true)return readSelectedList(command);
    return read(command);
  }

  /** 只请求官方菜单展开完成项，不切换事项状态；清单变化时不继续点击。 */
  async function showCompleted(command) {
    var doc = application();
    function currentList() {
      var active = doc && selectedListNode(doc);
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
    var active = selectedListNode(doc);
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
    assertConnected();
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
      assertConnected();
      // Chromium 的 execCommand 不产生 beforeinput；网页富文本需要先准备当前选区。
      if (!editor.dispatchEvent(new doc.defaultView.InputEvent('beforeinput', {
        bubbles: true, cancelable: true, composed: true,
        inputType: value ? 'insertText' : 'deleteContentBackward', data: value || null
      }))) { if (reportStage) reportStage('input-cancelled'); return false; }
      var instruction = textInstruction(value);
      // 多行 insertText 会拆成多次 input；仅包含转义文字和换行的片段可一次替换完整范围。
      if (reportStage) reportStage('input-command');
      assertConnected();
      var inserted = doc.execCommand(instruction.command, false, instruction.value);
      if (inserted) {
        if (reportStage) reportStage('input-accepted');
        // 新记录的文字保存由官方 input 回调排队；让该任务执行，随后继续交给官方自动保存。
        if (settleInitialInput) await new Promise(function (resolve) { root.setTimeout(resolve, 0); });
        assertConnected();
        if (reportStage) reportStage('input-settled');
        if (!editor.isConnected) { if (reportStage) reportStage('editor-detached'); return false; }
        if (settleInitialInput) { if (reportStage) reportStage('awaiting-autosave'); return true; }
        if (reportStage) reportStage('leaving-editor');
        assertConnected();
        editor.blur();
        assertConnected();
        if (!blurSeen && !focusOutSeen) {
          editor.dispatchEvent(new doc.defaultView.FocusEvent('blur', { bubbles: false, view: doc.defaultView, relatedTarget: doc.body }));
          assertConnected();
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
    var active = selectedListNode(doc);
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
    var active = doc && selectedListNode(doc);
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
    assertConnected();
    submitButton.click();
    var draft = await until(function () {
      var selected = selectedListNode(doc);
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
    if(refreshed.ok && refreshed.snapshot)rememberSettledCreation(doc,id,command.title.trim(),command.listId);
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
  function loadedSchedule(row, detailsAllowed) {
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
      } else if (row.querySelector('.due-date')) return detailsAllowed && row.querySelectorAll('.due-date').length===1 ? {detailsOnly:true,allDay:allDay===true} : null;
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
    var selected = selectedListNode(doc);
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
    var switches = panel.querySelectorAll('#atDate[role="switch"]');
    var enabled = switches.length === 1 && switches[0];
    if (!enabled || !['true','false'].includes(enabled.getAttribute('aria-checked'))) return null;
    if (enabled.getAttribute('aria-checked') === 'false') return panel.querySelector('.date-field [role="spinbutton"], #editTime') ? null : {date:null,time:null,timeZone:null};
    var date = scheduleSegments(panel,false);
    var timeSwitchNodes = panel.querySelectorAll('#editTime[role="checkbox"], #editTime[role="switch"]');
    var timeSwitch = timeSwitchNodes.length === 1 && timeSwitchNodes[0];
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
    detailScheduleReads.delete(command.id);
    var loaded = loadedSchedule(context.row);
    if (!loaded) {
      var candidate=loadedSchedule(context.row,true);
      if (!candidate || !candidate.detailsOnly) return result(false,'SCHEDULE_UNAVAILABLE','暂不能安全读取日期，请在官方页面查看。');
      var details = await openItemDetails(context);
      if (!details) return result(false,'EDIT_UNAVAILABLE','请先关闭官方页面中已有的编辑窗口，再刷新。');
      var value = readScheduleDetails(details);
      var cancelled = await cancelItemDetails(details);
      if (!cancelled || !itemContext(command)) {lastSnapshot=null;return result(false,'STALE_VIEW','读取期间事项或官方编辑窗口已变化，请先核对。');}
      // 缺失时间戳时，全天控件可能显示 UTC 日历日，不能推断苹果端日期。
      if (!value || value.date === null || value.time === null || candidate.allDay) return result(false,'SCHEDULE_UNAVAILABLE','官方日期来源尚未一致，请在官方页面查看。');
      var fingerprint = JSON.stringify(['official-details',value.date,value.time,value.timeZone]);
      if (detailScheduleReads.size >= 128) detailScheduleReads.delete(detailScheduleReads.keys().next().value);
      detailScheduleReads.set(command.id,{listId:command.listId,itemFingerprint:command.fingerprint,scheduleFingerprint:fingerprint,schedule:value});
      var current = read();
      if (!current.ok) {detailScheduleReads.delete(command.id);return current;}
      return result(true,'READY','已从官方详情读取日期。',{snapshot:current.snapshot,schedule:value,scheduleFingerprint:fingerprint,scheduleSource:'official-details',editorTimeZone:editorTimeZone()});
    }
    var refreshed = read();
    return result(true,'READY','已读取日期。',{snapshot:refreshed.snapshot,schedule:loaded.schedule,scheduleFingerprint:loaded.fingerprint,scheduleSource:'loaded-fields',editorTimeZone:editorTimeZone()});
  }

  /** 保存后的只读复核只打开同一事项详情一次，取消后再返回；不依赖已经清空的日期字段。 */
  async function verifySavedSchedule(context, command) {
    function currentContext() {
      var selected=listNodes(context.doc).filter(function(node){return node.getAttribute('aria-selected')==='true';});
      var row=context.doc.getElementById(command.id);
      if (selected.length!==1 || handle(selected[0])!==command.listId || !row || !rowNodes(context.doc).includes(row) || isLoading(context.doc)) return null;
      var item=readItem(row,command.listId);
      var fields=['id','listId','title','notes','notesTruncated','completed','flagged','priority','level','parentId','hierarchyReadable','disabled'];
      if (!item || !fields.every(function(key){return item[key]===context.item[key];})) return null;
      return {doc:context.doc,row:row,item:item};
    }
    var after=currentContext();
    if (!after) return false;
    var details=await openItemDetails(after);
    if (!details) return false;
    var value=readScheduleDetails(details);
    var loaded=loadedSchedule(after.row);
    var matches=sameSchedule(value,command.value) || loaded && sameSchedule(loaded.schedule,command.value) && detailsMatchLoadedSchedule(value,loaded);
    if (loaded && !sameSchedule(loaded.schedule,command.value) || command.value.date===null && after.row.querySelector('.due-date')) matches=false;
    var cancelled=await cancelItemDetails(details);
    return !!(cancelled && currentContext() && matches);
  }

  async function fillScheduleSegment(details, time, name, number, endpoint) {
    assertConnected();
    var fields = scheduleSegments(details.panel,time);
    var node = fields && fields[name];
    if (!node || node.getAttribute('aria-disabled') === 'true' || node.getAttribute('aria-readonly') === 'true' || node.getAttribute('contenteditable') !== 'true') return false;
    if (Number(node.getAttribute('aria-valuenow')) === number) return true;
    node.focus();
    assertConnected();
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
    if (!enabled && dateSwitch.getAttribute('aria-checked')==='true') {
      var timeControls=panel.querySelectorAll('#editTime[role="checkbox"], #editTime[role="switch"]');
      var clearingTime=timeControls.length===1 && timeControls[0];
      if(!clearingTime || !['true','false'].includes(clearingTime.getAttribute('aria-checked')))return false;
      // 先取消时间并等待官方控件确认，再关闭日期，避免把仍启用的时间留在隐藏草稿中。
      if(clearingTime.getAttribute('aria-checked')==='true') {
        if(clearingTime.disabled || clearingTime.getAttribute('aria-disabled')==='true')return false;
        activate(clearingTime);
        if(!await until(function(){var controls=panel.querySelectorAll('#editTime[role="checkbox"], #editTime[role="switch"]');var draft=readScheduleDetails(details);return controls.length===1 && controls[0].getAttribute('aria-checked')==='false' && draft && draft.date!==null && draft.time===null;},900))return false;
      }
    }
    if (dateSwitch.getAttribute('aria-checked') !== String(enabled)) activate(dateSwitch);
    if (!await until(function () { var current = panel.querySelector('#atDate[role="switch"]'); return current && current.getAttribute('aria-checked') === String(enabled); },900)) return false;
    if (!enabled) return sameSchedule(readScheduleDetails(details),value);
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
    var receipt = detailScheduleReads.get(command.id);
    var candidate = !loaded && loadedSchedule(context.row,true);
    var fromDetails = candidate && candidate.detailsOnly && !candidate.allDay && receipt && receipt.listId===command.listId && receipt.itemFingerprint===command.fingerprint && receipt.scheduleFingerprint===command.expectedScheduleFingerprint && sameSchedule(receipt.schedule,command.expectedSchedule);
    if (!loaded && !fromDetails) return result(false,'SCHEDULE_UNAVAILABLE','暂不能安全读取日期，请重新读取或在官方页面编辑。');
    if (loaded && (loaded.fingerprint !== command.expectedScheduleFingerprint || !sameSchedule(loaded.schedule,command.expectedSchedule))) return result(false,'STALE_VIEW','日期已变化，请重新读取。');
    if (loaded && sameSchedule(loaded.schedule,command.value)) return result(true,'UNCHANGED','日期已经处于目标状态，未再次存储。',{snapshot:read().snapshot,dispatched:false,cloudConfirmed:false});
    var details = await openItemDetails(context);
    if (!details) return result(false,'EDIT_UNAVAILABLE','请先关闭官方页面中已有的编辑窗口，再刷新。');
    var current = readScheduleDetails(details);
    var save = detailAction(details,true);
    if (!current || !save || details.panel.querySelector('.repeat-info')) {
      await cancelItemDetails(details); lastSnapshot = null;
      return result(false,'SCHEDULE_UNAVAILABLE','当前事项需要在官方页面编辑日期。');
    }
    if (fromDetails ? !sameSchedule(current,receipt.schedule) : !detailsMatchLoadedSchedule(current,loaded)) {
      await cancelItemDetails(details); lastSnapshot = null;
      return result(false,'SCHEDULE_UNAVAILABLE','官方日期与当前读取不一致，请在官方页面核对。',{dispatched:false,cloudConfirmed:false});
    }
    detailScheduleReads.delete(command.id);
    if (sameSchedule(current,command.value)) {
      if (!await cancelItemDetails(details) || !itemContext(command)) {lastSnapshot=null;return result(false,'STALE_VIEW','官方编辑窗口或事项已变化，请先核对。',{dispatched:false,cloudConfirmed:false});}
      return result(true,'UNCHANGED','日期已经处于目标状态，未再次存储。',{snapshot:read().snapshot,dispatched:false,cloudConfirmed:false});
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
    var observed = await verifySavedSchedule(context,command);
    if (!observed) return result(false,'UNCERTAIN_WRITE','官方详情尚未确认目标日期，请先读取核对。',{dispatched:true,cloudConfirmed:false});
    var refreshed = read();
    if (!refreshed.ok) return result(false,'UNCERTAIN_WRITE','网页尚未确认目标日期，请先读取核对。',{dispatched:true,cloudConfirmed:false});
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

  function listContext(command,allowEmpty) {
    var doc=application();
    if(!doc || !lastSnapshot || command.pageId!==pageId || isLoading(doc)) return null;
    if(allowEmpty && command.listId==='' && command.expectedListFingerprint==='empty-list-set' && lastSnapshot.emptyAccount && !listNodes(doc).length && doc.querySelector('.no-lists-note')) return {doc:doc,node:null,list:null,empty:true};
    if(lastSnapshot.activeListId!==command.listId) return null;
    var nodes=listNodes(doc).filter(function(node){return node.getAttribute('aria-selected')==='true';});
    var list=nodes.length===1 && readList(nodes[0]);
    return list && list.id===command.listId && list.fingerprint===command.expectedListFingerprint?{doc:doc,node:nodes[0],list:list}:null;
  }

  function listAction(panel,kind) {
    var nodes=panel.querySelectorAll(kind==='done'?'.done-button':'.cancel-button');
    return nodes.length===1 && !nodes[0].disabled && nodes[0].getAttribute('aria-disabled')!=='true'?nodes[0]:null;
  }

  async function cancelListPanel(panel) {
    if(!panel.isConnected) return true;
    var cancel=listAction(panel,'cancel');
    if(!cancel) return false;
    activate(cancel);return !!await until(function(){return !panel.isConnected;},1000);
  }

  async function openListPanel(context,creating,command) {
    var doc=context.doc,focused=doc.activeElement;
    if(doc.querySelector('.reminder-list-detail,.details-popover') || focused && focused.closest('[contenteditable="true"],input,textarea')) return null;
    var buttons=doc.querySelectorAll(creating?'.new-list-button':'.list-detail-button');
    if(buttons.length!==1 || buttons[0].disabled || buttons[0].getAttribute('aria-disabled')==='true') return null;
    activate(buttons[0]);
    if(!creating) {
      var menu=await until(function(){
        var nodes=Array.from(doc.querySelectorAll('[role="menuitem"]')).filter(function(node){return !node.closest('[hidden],[aria-hidden="true"]') && /^(显示列表信息|显示清单信息|Show List Info)$/i.test(text(node));});
        return nodes.length===1 && !nodes[0].disabled && nodes[0].getAttribute('aria-disabled')!=='true'?nodes[0]:false;
      },1200);
      if(!menu || !listContext(command)) {
        buttons[0].dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return null;
      }
      activate(menu);
    }
    return until(function(){var panels=doc.querySelectorAll('.reminder-list-detail');return panels.length===1?panels[0]:false;},1800);
  }

  /** 名称只经标准输入控件替换一次；不读取或调用网页内部表单状态。 */
  function fillListName(panel,value) {
    assertConnected();
    var inputs=panel.querySelectorAll('.name-textfield input[type="text"],.name-textfield input:not([type]),input.name-textfield[type="text"]');
    var input=inputs.length===1 && inputs[0];
    if(!input || input.disabled || input.readOnly || input.getAttribute('aria-disabled')==='true' || input.maxLength>=0 && value.length>input.maxLength) return false;
    var view=input.ownerDocument.defaultView,previous=input.value;
    input.focus();input.setSelectionRange(0,previous.length);
    assertConnected();
    var before=new view.InputEvent('beforeinput',{bubbles:true,cancelable:true,composed:true,inputType:'insertText',data:value});
    input.dispatchEvent(before);
    if(input.value===value) return true;
    if(before.defaultPrevented || input.value!==previous) return false;
    assertConnected();
    Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype,'value').set.call(input,value);
    assertConnected();
    input.dispatchEvent(new view.InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:value}));
    return input.isConnected && input.value===value;
  }

  async function changeList(command) {
    if(typeof command.value!=='string' || !command.value.trim() || command.value.length>100 || /[\r\n]/.test(command.value) || typeof command.expectedListFingerprint!=='string' || !command.expectedListFingerprint || command.expectedListFingerprint.length>4000 ||
       typeof command.requestId!=='string' || !/^[a-z0-9-]{1,100}$/.test(command.requestId)) return result(false,'INVALID_COMMAND','请输入有效的清单名称。');
    if(listRequests.has(command.requestId)) return result(false,'ALREADY_SUBMITTED','本次清单修改已提交，请先读取核对。');
    if(listRequests.size>=512) return result(false,'LIST_OPERATION_LIMIT','本页操作较多，请重载官方页面后核对。');
    var creating=command.type==='createList',selection=command.appearance,context=listContext(command,creating),value=command.value.trim();
    if(selection!==undefined && (!creating || !validAppearanceSelection(selection)))return result(false,'INVALID_COMMAND','清单外观参数无效。');
    if(!context) return result(false,'STALE_VIEW','清单已变化，请先刷新。');
    if(!creating && context.list.title===value) return result(true,'UNCHANGED','清单名称未改变，未再次存储。',{snapshot:read().snapshot,dispatched:false,cloudConfirmed:false});
    var beforeLists=listNodes(context.doc).map(readList),beforeItems=creating?[]:rowNodes(context.doc).map(function(row){var item=readItem(row,command.listId);return item && item.fingerprint;});
    var panel=await openListPanel(context,creating,command);
    if(!panel) {lastSnapshot=null;return result(false,'LIST_UNAVAILABLE','当前网页暂不能编辑清单，请在官方页面核对。');}
    var inputs=panel.querySelectorAll('.name-textfield input');
    if(inputs.length!==1 || inputs[0].type!=='text' || !creating && inputs[0].value!==context.list.title || panel.querySelectorAll('.done-button').length!==1 || !listAction(panel,'cancel')) {
      await cancelListPanel(panel);lastSnapshot=null;return result(false,'STALE_VIEW','官方清单详情已变化，请重新读取。',{dispatched:false,cloudConfirmed:false});
    }
    // 名称和外观留在同一个官方草稿，全部核对后才点击一次完成。
    function draftBound() { return context.empty?application()===context.doc && listNodes(context.doc).length<=1:!!listContext(command); }
    if(selection && !await applyListDraftAppearance(panel,selection,draftBound)) {
      var cancelled=await cancelListPanel(panel);lastSnapshot=null;
      return result(false,cancelled?'STALE_VIEW':'UNCERTAIN_WRITE','新清单外观未通过核对，请先刷新。',{dispatched:!cancelled,cloudConfirmed:false});
    }
    if(!fillListName(panel,value) || !draftBound() || selection && !matchesAppearance(appearancePanel(panel),selection)) {
      await cancelListPanel(panel);lastSnapshot=null;return result(false,'UNCERTAIN_WRITE','清单草稿未通过核对，请先读取，不要重复提交。',{dispatched:true,cloudConfirmed:false});
    }
    var done=await until(function(){return listAction(panel,'done');},900);
    if(!done || selection && (!draftBound() || inputs[0].value!==value || !matchesAppearance(appearancePanel(panel),selection))) {await cancelListPanel(panel);lastSnapshot=null;return result(false,'UNCERTAIN_WRITE','清单控件已变化，请先读取核对。',{dispatched:true,cloudConfirmed:false});}
    listRequests.add(command.requestId);lastSnapshot=null;activate(done);
    if(!await until(function(){return !panel.isConnected;},1800)) return result(false,'UNCERTAIN_WRITE','清单保存尚未确认，请先读取核对。',{dispatched:true,cloudConfirmed:false});
    var observed=await until(function(){
      var current=read();if(!current.ok) return false;
      var lists=current.snapshot.lists,existing=lists.filter(function(list){return beforeLists.some(function(old){return old.id===list.id;});});
      var othersSame=beforeLists.filter(function(list){return creating || list.id!==command.listId;}).every(function(old){return lists.some(function(list){return list.fingerprint===old.fingerprint;});});
      if(!othersSame) return false;
      if(creating) {
        var added=lists.filter(function(list){return !beforeLists.some(function(old){return old.id===list.id;});});
        return added.length===1 && added[0].title===value && existing.length===beforeLists.length && current.snapshot.activeListId===added[0].id &&
          (!selection || added[0].color===selection.color && added[0].icon?.key===selection.iconKey)?current:false;
      }
      var target=lists.find(function(list){return list.id===command.listId;});
      return lists.length===beforeLists.length && target && target.title===value && target.color===context.list.color && (target.icon && target.icon.key)===(context.list.icon && context.list.icon.key) && current.snapshot.activeListId===command.listId &&
        JSON.stringify(current.snapshot.items.map(function(item){return item.fingerprint;}))===JSON.stringify(beforeItems)?current:false;
    },2600);
    if(!observed) {lastSnapshot=null;return result(false,'UNCERTAIN_WRITE','网页尚未确认目标清单，请先读取，不要重复保存。',{dispatched:true,cloudConfirmed:false});}
    return result(true,'WEB_STATE_OBSERVED',creating?'网页已新增清单；云端保存仍需核对。':'网页清单名称已更新；云端保存仍需核对。',{snapshot:observed.snapshot,dispatched:true,cloudConfirmed:false});
  }

  function appearancePanel(panel) {
    var groups=['color-picker','badge-emblem-picker'].map(function(kind){
      var pickers=panel.querySelectorAll('.'+kind);if(pickers.length!==1)return null;
      var buttons=Array.from(pickers[0].querySelectorAll('button.picker-grid-item')).filter(visibleControl);
      if(!buttons.length || buttons.length>100 || buttons.some(function(button){return button.disabled || button.getAttribute('aria-disabled')==='true';}))return null;
      var options=buttons.map(function(button,index){
        if(kind==='color-picker'){
          var color=button.style.backgroundColor,match=/^rgb\((\d+), (\d+), (\d+)\)$/.exec(color);
          if(!match || match.slice(1).some(function(value){return +value>255;}) || button.children.length)return null;
          return {key:color,color:color,index:index,selected:button.classList.contains('is-selected')};
        }
        var icon=button.children.length===1 && listIcon(button.children[0]);
        return icon?{key:icon.key,icon:icon,index:index,selected:button.classList.contains('is-selected')}:null;
      });
      if(options.some(function(option){return !option;}) || new Set(options.map(function(option){return option.key;})).size!==options.length || options.filter(function(option){return option.selected;}).length!==1)return null;
      return options;
    });
    if(groups.some(function(group){return !group;}))return null;
    var colors=groups[0],icons=groups[1];
    return {colors:colors,icons:icons,color:colors.find(function(option){return option.selected;}).key,iconKey:icons.find(function(option){return option.selected;}).key,
      fingerprint:JSON.stringify(groups.map(function(group){return group.map(function(option){return option.key;});}))};
  }

  function validAppearanceSelection(selection) {
    return selection && typeof selection.color==='string' && /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/.test(selection.color) &&
      typeof selection.iconKey==='string' && /^shape-[a-f0-9]+-[a-f0-9]+-\d{1,5}$/.test(selection.iconKey) &&
      typeof selection.expectedAppearanceFingerprint==='string' && selection.expectedAppearanceFingerprint.length>0 && selection.expectedAppearanceFingerprint.length<=20000;
  }

  function matchesAppearance(appearance,selection) {
    return appearance && appearance.fingerprint===selection.expectedAppearanceFingerprint && appearance.color===selection.color && appearance.iconKey===selection.iconKey;
  }

  /** 只读取临时新建草稿的选项。取消并确认原清单集合后，本地才显示可选外观。 */
  async function getListCreateOptions(command) {
    var context=listContext(command,true);
    if(!context)return result(false,'STALE_VIEW','清单已变化，请先刷新。');
    var before=listNodes(context.doc).map(function(node){return readList(node).fingerprint;});
    var panel=await openListPanel(context,true,command);
    if(!panel){lastSnapshot=null;return result(false,'LIST_UNAVAILABLE','当前网页暂不能新建清单。');}
    var appearance=appearancePanel(panel);
    if(!await cancelListPanel(panel) || !listContext(command,true) ||
      JSON.stringify(listNodes(context.doc).map(function(node){return readList(node).fingerprint;}))!==JSON.stringify(before)) {
      lastSnapshot=null;return result(false,'STALE_VIEW','官方清单草稿尚待核对，请先刷新。');
    }
    return result(true,'LIST_CREATE_OPTIONS','',{appearance:appearance,dispatched:false,cloudConfirmed:false});
  }

  /** 外观选项可能在每次点击后重绘，按当前面板指纹核对目标，再逐个修改草稿。 */
  async function applyListDraftAppearance(panel,selection,bound) {
    var appearance=appearancePanel(panel);
    if(!appearance || appearance.fingerprint!==selection.expectedAppearanceFingerprint || !bound())return false;
    var color=appearance.colors.find(function(option){return option.key===selection.color;});
    var icon=appearance.icons.find(function(option){return option.key===selection.iconKey;});
    if(!color || !icon)return false;
    for(var change of [{group:'color-picker',option:color,value:'color'},{group:'badge-emblem-picker',option:icon,value:'iconKey'}]) {
      var current=appearancePanel(panel);
      if(!current || current.fingerprint!==appearance.fingerprint || !bound())return false;
      if(current[change.value]===change.option.key)continue;
      activate(Array.from(panel.querySelectorAll('.'+change.group+' button.picker-grid-item')).filter(visibleControl)[change.option.index]);
      if(!await until(function(){var state=appearancePanel(panel);return state && state[change.value]===change.option.key;},700))return false;
    }
    return bound() && matchesAppearance(appearancePanel(panel),selection);
  }

  async function listAppearance(command,writing) {
    if(typeof command.expectedListFingerprint!=='string' || !command.expectedListFingerprint || command.expectedListFingerprint.length>4000 || writing &&
      (!validAppearanceSelection(command) || typeof command.requestId!=='string' || !/^[a-z0-9-]{1,100}$/.test(command.requestId)))return result(false,'INVALID_COMMAND','清单外观参数无效。');
    if(writing && listRequests.has(command.requestId))return result(false,'ALREADY_SUBMITTED','本次外观修改已提交，请先读取核对。');
    if(writing && listRequests.size>=512)return result(false,'LIST_OPERATION_LIMIT','本页操作较多，请重载后核对。');
    var context=listContext(command);if(!context)return result(false,'STALE_VIEW','清单已变化，请先刷新。');
    var beforeLists=listNodes(context.doc).map(readList),beforeItems=rowNodes(context.doc).map(function(row){var item=readItem(row,command.listId);return item && item.fingerprint;});
    var panel=await openListPanel(context,false,command);
    if(!panel){lastSnapshot=null;return result(false,'LIST_UNAVAILABLE','当前网页暂不能编辑清单外观。');}
    var input=panel.querySelectorAll('.name-textfield input'),appearance=appearancePanel(panel);
    if(input.length!==1 || input[0].value!==context.list.title || !appearance || appearance.color!==context.list.color || !context.list.icon || appearance.iconKey!==context.list.icon.key || !listAction(panel,'cancel')){
      var shape={currentIconKnown:!!context.list.icon,colorMatches:appearance && appearance.color===context.list.color,iconMatches:appearance && appearance.iconKey===(context.list.icon && context.list.icon.key),
        colorButtons:panel.querySelectorAll('.color-picker button.picker-grid-item').length,selectedColors:panel.querySelectorAll('.color-picker button.picker-grid-item.is-selected').length,
        iconButtons:panel.querySelectorAll('.badge-emblem-picker button.picker-grid-item').length,selectedIcons:panel.querySelectorAll('.badge-emblem-picker button.picker-grid-item.is-selected').length,
        unknownIcons:Array.from(panel.querySelectorAll('.badge-emblem-picker button.picker-grid-item')).map(function(button,index){return listIcon(button.children[0])?null:index;}).filter(function(index){return index!==null;})};
      await cancelListPanel(panel);lastSnapshot=null;return result(false,'LIST_APPEARANCE_UNAVAILABLE','清单图标或颜色不可核对，请在官方页面设置。',{dispatched:false,cloudConfirmed:false,appearanceShape:shape});
    }
    if(!writing || appearance.color===command.color && appearance.iconKey===command.iconKey){
      if(!await cancelListPanel(panel)){lastSnapshot=null;return result(false,'LIST_UNAVAILABLE','官方外观窗口尚未关闭，请先核对。');}
      if(!listContext(command)){lastSnapshot=null;return result(false,'STALE_VIEW','清单已变化，请先刷新。');}
      return result(true,writing?'UNCHANGED':'LIST_APPEARANCE_READY',writing?'外观未改变，未再次存储。':'请选择清单颜色与图标。',{appearance:appearance,dispatched:false,cloudConfirmed:false});
    }
    var color=appearance.colors.find(function(option){return option.key===command.color;}),icon=appearance.icons.find(function(option){return option.key===command.iconKey;});
    if(appearance.fingerprint!==command.expectedAppearanceFingerprint || !color || !icon || !listContext(command)){
      await cancelListPanel(panel);lastSnapshot=null;return result(false,'STALE_VIEW','外观选项已变化，请重新打开编辑器。',{dispatched:false,cloudConfirmed:false});
    }
    listRequests.add(command.requestId);
    var changed=await applyListDraftAppearance(panel,command,function(){return !!listContext(command);});
    var done=listAction(panel,'done');
    if(!changed || input[0].value!==context.list.title || !listContext(command) || !done){
      await cancelListPanel(panel);lastSnapshot=null;return result(false,'UNCERTAIN_WRITE','外观草稿未通过核对，请先读取，不要重复提交。',{dispatched:true,cloudConfirmed:false});
    }
    lastSnapshot=null;activate(done);
    if(!await until(function(){return !panel.isConnected;},1800))return result(false,'UNCERTAIN_WRITE','外观保存尚未确认，请先读取核对。',{dispatched:true,cloudConfirmed:false});
    var observed=await until(function(){
      var current=read();if(!current.ok || current.snapshot.activeListId!==command.listId || current.snapshot.lists.length!==beforeLists.length)return false;
      var target=current.snapshot.lists.find(function(list){return list.id===command.listId;});
      return target && target.title===context.list.title && target.color===command.color && target.icon && target.icon.key===command.iconKey &&
        beforeLists.filter(function(list){return list.id!==command.listId;}).every(function(old){return current.snapshot.lists.some(function(list){return list.fingerprint===old.fingerprint;});}) &&
        JSON.stringify(current.snapshot.items.map(function(item){return item.fingerprint;}))===JSON.stringify(beforeItems)?current:false;
    },2600);
    if(!observed){lastSnapshot=null;return result(false,'UNCERTAIN_WRITE','清单外观尚未准确确认，请先读取核对，不要重复保存。',{dispatched:true,cloudConfirmed:false});}
    return result(true,'WEB_STATE_OBSERVED','网页清单外观已更新；云端保存仍需核对。',{snapshot:observed.snapshot,dispatched:true,cloudConfirmed:false});
  }

  function visibleControl(node) {
    return !node.closest('[hidden],[aria-hidden="true"]') && node.ownerDocument.defaultView.getComputedStyle(node).display!=='none';
  }

  function listDeletionControls(panel) {
    var controls=Array.from(panel.querySelectorAll('ui-alert-footer [role="button"],ui-alert-footer button')).filter(visibleControl);
    var cancel=controls.filter(function(node){return /^(取消|Cancel)$/i.test(text(node));});
    var remove=controls.filter(function(node){return /^(删除|Delete)$/i.test(text(node)) && (node.classList.contains('destructive') || node.hasAttribute('destructive'));});
    var enabled=function(nodes){return nodes.length===1 && !nodes[0].disabled && nodes[0].getAttribute('aria-disabled')!=='true'?nodes[0]:null;};
    return {cancel:enabled(cancel),remove:enabled(remove)};
  }

  function unsharedListDeletion(panel,name) {
    var title=text(panel.querySelector('ui-alert-content h1.title,h1.title'));
    var normalize=function(value){return value.replace(/[“”]/g,'"').toLowerCase();};
    return ['删除列表“'+name+'”？','Delete List "'+name+'"?','Delete "'+name+'"?'].some(function(value){return normalize(value)===normalize(title);});
  }

  async function cancelListDeletion(panel) {
    if(!panel.isConnected)return true;
    var cancel=listDeletionControls(panel).cancel;
    if(!cancel)return false;
    activate(cancel);return !!await until(function(){return !panel.isConnected;},1000);
  }

  async function deleteList(command) {
    if(command.confirmed!==true || typeof command.expectedListFingerprint!=='string' || !command.expectedListFingerprint || command.expectedListFingerprint.length>4000 ||
       typeof command.requestId!=='string' || !/^[a-z0-9-]{1,100}$/.test(command.requestId)) return result(false,'INVALID_COMMAND','请先确认删除这一份清单及其中全部事项。');
    if(listRequests.has(command.requestId)) return result(false,'ALREADY_SUBMITTED','本次清单删除已提交，请先读取核对，不要重复删除。');
    if(listRequests.size>=512)return result(false,'LIST_OPERATION_LIMIT','本页操作较多，请重载官方页面后核对。');
    var context=listContext(command);
    if(!context)return result(false,'STALE_VIEW','清单已变化，请先刷新。');
    var doc=context.doc,focused=doc.activeElement;
    if(doc.querySelector('.reminder-list-detail,.details-popover') || Array.from(doc.querySelectorAll('[role="alertdialog"]')).some(visibleControl) || focused && focused.closest('[contenteditable="true"],input,textarea')) return result(false,'EDIT_UNAVAILABLE','请先结束官方页面中的编辑或确认窗口。');
    var buttons=doc.querySelectorAll('.list-detail-button');
    if(buttons.length!==1 || buttons[0].disabled || buttons[0].getAttribute('aria-disabled')==='true') return result(false,'LIST_DELETE_UNAVAILABLE','请在官方页面删除此清单。');
    var others=listNodes(doc).map(readList).filter(function(list){return list.id!==command.listId;});
    activate(buttons[0]);
    var action=await until(function(){var nodes=Array.from(doc.querySelectorAll('[role="menuitem"]')).filter(function(node){return visibleControl(node) && /^(删除列表|删除清单|Delete List)$/i.test(text(node));});return nodes.length===1 && !nodes[0].disabled && nodes[0].getAttribute('aria-disabled')!=='true'?nodes[0]:false;},1200);
    if(!action || !listContext(command)) {buttons[0].dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));lastSnapshot=null;return result(false,'LIST_DELETE_UNAVAILABLE','清单菜单已变化，请在官方页面核对。');}
    // 在激活可能改变页面的删除入口前登记请求；未知结果不再派发同一请求。
    listRequests.add(command.requestId);activate(action);
    var panel=await until(function(){var nodes=Array.from(doc.querySelectorAll('[role="alertdialog"]')).filter(visibleControl);return nodes.length===1?nodes[0]:false;},1800);
    if(!panel) {lastSnapshot=null;return result(false,'UNCERTAIN_WRITE','官方删除确认尚未就绪，请先读取核对，不要重复提交。',{dispatched:true,cloudConfirmed:false});}
    var controls=listDeletionControls(panel);
    if(!unsharedListDeletion(panel,context.list.title) || !controls.remove || !controls.cancel || !listContext(command)) {
      await cancelListDeletion(panel);lastSnapshot=null;
      return result(false,'LIST_DELETE_UNAVAILABLE','共享清单或确认内容已变化，请在官方页面处理。',{dispatched:false,cloudConfirmed:false});
    }
    lastSnapshot=null;activate(controls.remove);
    var observed=await until(function(){
      if(panel.isConnected)return false;
      var lists=listNodes(doc).map(readList);
      if(lists.some(function(list){return list.id===command.listId;}) || lists.length!==others.length || !others.every(function(old){return lists.some(function(list){return list.fingerprint===old.fingerprint;});}))return false;
      if(!lists.length && !doc.querySelector('.no-lists-note'))return false;
      return lists;
    },2600);
    if(!observed) {lastSnapshot=null;return result(false,'UNCERTAIN_WRITE','清单删除尚未准确确认，请先读取核对，不要重复提交。',{dispatched:true,cloudConfirmed:false});}
    return result(true,'WEB_STATE_OBSERVED','网页已移除清单；请选择另一份清单，云端保存仍需核对。',{snapshot:navigationSnapshot(doc,observed),needsListSelection:true,removed:true,dispatched:true,cloudConfirmed:false});
  }

  /** 删除先用官方键盘导航形成单选；不点击标题、不使用内部选区模型或删除接口。 */
  function deletionScope(context) {
    var grids=context.doc.querySelectorAll('[role="treegrid"]');
    var rows=rowNodes(context.doc);
    if(grids.length!==1 || !grids[0].contains(context.row) || rows.length>80 || !rows.length ||
       Number(grids[0].getAttribute('aria-rowcount'))!==rows.length || context.row.hasAttribute('aria-expanded') ||
       rows.some(function(row,index){return row.closest('[role="treegrid"]')!==grids[0] || Number(row.getAttribute('aria-posinset'))!==index+1 || !['true','false'].includes(row.getAttribute('aria-selected'));})) return null;
    var index=rows.indexOf(context.row),level=Number(context.row.getAttribute('aria-level'));
    if(index<0 || !Number.isInteger(level) || level<1 || rows[index+1] && Number(rows[index+1].getAttribute('aria-level'))>level) return null;
    return {grid:grids[0],rows:rows,index:index};
  }

  async function prepareDelete(command) {
    var context=itemContext(command),scope=context && deletionScope(context);
    if(!context) return {error:result(false,'STALE_VIEW','事项已变化，请先刷新。')};
    var focused=context.doc.activeElement;
    if(!scope || focused && focused.closest('[contenteditable="true"],input,textarea')) return {error:result(false,'DELETE_UNAVAILABLE','请在官方页面核对；当前仅支持已完整加载清单中的普通单项删除。')};
    var details=await openItemDetails(context);
    if(!details) return {error:result(false,'EDIT_UNAVAILABLE','请先关闭官方页面已有的编辑窗口，再刷新。')};
    var recurring=!!details.panel.querySelector('.repeat-info');
    if(!await cancelItemDetails(details) || recurring) {lastSnapshot=null;return {error:result(false,'DELETE_UNAVAILABLE','重复事项或编辑状态尚未结束，请在官方页面删除。')};}
    function unchanged() {
      var current=itemContext(command),latest=current && deletionScope(current);
      return latest && latest.rows.length===scope.rows.length && latest.rows.every(function(row,index){return row===scope.rows[index];});
    }
    if(!unchanged()) return {error:result(false,'STALE_VIEW','事项或清单已变化，请重新核对。')};
    function single(row) {
      var selected=scope.rows.filter(function(item){return item.getAttribute('aria-selected')==='true';});
      return unchanged() && selected.length===1 && selected[0]===row && context.doc.activeElement===row;
    }
    function key(node,name) {
      assertConnected();
      node.dispatchEvent(new context.doc.defaultView.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,repeat:false}));
    }
    assertConnected();scope.grid.focus();key(scope.grid,'Home');
    var first=scope.rows[0];
    var firstSelected=await until(function(){return single(first);},900);
    // 只有一个已核对的行时，可按官方界面的单击行为选中它。仍须核对焦点与排他选区。
    if(!firstSelected && scope.rows.length===1 && unchanged() && !context.doc.activeElement?.closest('[contenteditable="true"],input,textarea')) {
      activate(first);
      firstSelected=await until(function(){return single(first);},900);
    }
    if(!firstSelected) return {error:result(false,'DELETE_UNAVAILABLE','无法确认官方页面单选，请在官方页面核对。')};
    for(var index=1;index<=scope.index;index++) {
      key(scope.rows[index-1],'ArrowDown');
      if(!await until(function(){return single(scope.rows[index]);},900)) return {error:result(false,'DELETE_UNAVAILABLE','选区已变化，请在官方页面核对。')};
    }
    return {context:context,scope:scope,single:function(){return single(context.row);}};
  }

  async function getDeleteInfo(command) {
    var prepared=await prepareDelete(command);
    if(prepared.error) return prepared.error;
    var refreshed=read();
    if(!refreshed.ok) return refreshed;
    if(!prepared.single()) return result(false,'STALE_VIEW','目标或选区已变化，请重新核对。');
    return result(true,'DELETE_READY','仅删除这一条普通事项；删除会同步到其他设备。',{snapshot:refreshed.snapshot,deleteReady:true,dispatched:false,cloudConfirmed:false});
  }

  async function deleteItem(command) {
    if(command.confirmed!==true || typeof command.requestId!=='string' || !/^[a-z0-9-]{1,100}$/.test(command.requestId)) return result(false,'INVALID_COMMAND','请先确认删除这一条事项。');
    if(deletionRequests.has(command.requestId)) return result(false,'ALREADY_SUBMITTED','本次删除已提交，请先读取核对，不要重复删除。');
    if(deletionRequests.size>=512) return result(false,'DELETION_LIMIT','本次操作较多，请重载官方页面后再核对。');
    var prepared=await prepareDelete(command);
    if(prepared.error) return prepared.error;
    if(!prepared.single()) return result(false,'STALE_VIEW','目标或选区已变化，请重新核对。');
    var context=prepared.context;
    var remaining=prepared.scope.rows.filter(function(row){return row!==context.row;}).map(function(row){var item=readItem(row,command.listId);return item && item.fingerprint;});
    if(remaining.some(function(item){return !item;})) return result(false,'DELETE_UNAVAILABLE','其他行尚未就绪，请在官方页面核对。');
    deletionRequests.add(command.requestId);lastSnapshot=null;
    assertConnected();
    context.row.dispatchEvent(new context.doc.defaultView.KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,repeat:false}));
    var absent=await until(function(){return !context.doc.getElementById(command.id);},1800);
    var refreshed=read();
    var same=refreshed.ok && refreshed.snapshot.pageId===command.pageId && refreshed.snapshot.activeListId===command.listId &&
      JSON.stringify(refreshed.snapshot.items.map(function(item){return item.fingerprint;}))===JSON.stringify(remaining);
    if(!absent || !same) {lastSnapshot=null;return result(false,'UNCERTAIN_WRITE','删除结果尚未确认，请先读取核对，不要重复提交。',{dispatched:true,cloudConfirmed:false});}
    return result(true,'WEB_STATE_OBSERVED','网页已移除这一条事项；云端保存仍需核对。',{snapshot:refreshed.snapshot,removed:true,dispatched:true,cloudConfirmed:false});
  }

  function hierarchyContent(item) {
    return JSON.stringify([item.id,item.title,item.notes,item.notesTruncated,item.metadata,item.completed,item.scheduleFingerprint,item.flagged,item.priority,item.disabled]);
  }

  function hierarchyScope(context) {
    var grids=context.doc.querySelectorAll('[role="treegrid"]'),rows=rowNodes(context.doc);
    if(grids.length!==1 || !rows.length || rows.length>80 || Number(grids[0].getAttribute('aria-rowcount'))!==rows.length || rows.some(function(row){return row.closest('[role="treegrid"]')!==grids[0];}))return null;
    var entries=rows.map(function(row){return {row:row,item:readItem(row,context.item.listId)};});
    if(entries.some(function(entry){return !entry.item || !entry.item.hierarchyReadable || !['true','false'].includes(entry.row.getAttribute('aria-selected'));}))return null;
    var groups=new Map();
    entries.forEach(function(entry){var parent=entry.item.parentId;groups.has(parent)?groups.get(parent).push(entry):groups.set(parent,[entry]);});
    if(entries.some(function(entry){
      var siblings=groups.get(entry.item.parentId),children=groups.get(entry.item.id),expanded=entry.row.getAttribute('aria-expanded');
      return Number(entry.row.getAttribute('aria-posinset'))!==siblings.indexOf(entry)+1 || Number(entry.row.getAttribute('aria-setsize'))!==siblings.length ||
        (children?expanded!=='true':expanded!==null);
    }))return null;
    var fingerprint=JSON.stringify(entries.map(function(entry){return [entry.item.fingerprint,entry.row.getAttribute('aria-posinset'),entry.row.getAttribute('aria-setsize')];}));
    return fingerprint.length<=200000?{grid:grids[0],entries:entries,fingerprint:fingerprint}:null;
  }

  function subtaskPlan(scope,id,direction) {
    var index=scope.entries.findIndex(function(entry){return entry.item.id===id;}),entry=scope.entries[index];
    if(!entry || !['indent','outdent'].includes(direction))return null;
    var parents=scope.entries.map(function(entry){return {id:entry.item.id,parentId:entry.item.parentId};}),affected=[entry.item.title],parent;
    if(direction==='indent'){
      if(entry.item.parentId || scope.entries.some(function(other){return other.item.parentId===id;}))return null;
      for(var cursor=index-1;cursor>=0;cursor--){if(scope.entries[cursor].item.level===1){parent=scope.entries[cursor].item;break;}}
      if(!parent || parent.completed!==entry.item.completed)return null;
      parents[index].parentId=parent.id;
    }else{
      if(!entry.item.parentId)return null;
      parent=scope.entries.find(function(other){return other.item.id===entry.item.parentId;}).item;
      parents[index].parentId=null;
      // 官方提升快捷键会把后续同级子事项归入被提升事项；确认时完整说明这一影响。
      for(var tail=index+1;tail<parents.length && parents[tail].parentId===entry.item.parentId;tail++){parents[tail].parentId=id;affected.push(scope.entries[tail].item.title);}
    }
    return {direction:direction,parent:parent,parents:parents,affectedTitles:affected};
  }

  async function prepareSubtask(command) {
    var context=itemContext(command),scope=context && hierarchyScope(context),focused=context && context.doc.activeElement;
    if(!context)return {error:result(false,'STALE_VIEW','事项已变化，请先刷新。')};
    var plan=scope && subtaskPlan(scope,command.id,command.direction);
    function unavailable(stage,message){return {error:result(false,'SUBTASK_UNAVAILABLE',message,{subtaskStage:stage,dispatched:false,cloudConfirmed:false})};}
    if(!scope)return unavailable('structure','当前清单层级尚不可核对，请在官方页面查看完整清单后重新读取。');
    if(!plan)return unavailable('plan','当前不能确认缩进或提升的影响；不能带有子项或跨完成状态缩进。');
    if(focused && focused.closest('[contenteditable="true"],input,textarea'))return unavailable('active-editor','官方页面仍在编辑，请先结束该处编辑再读取核对。');
    for(var item of [context.item,plan.parent]){
      var related=scope.entries.find(function(entry){return entry.item.id===item.id;});
      var details=await openItemDetails({doc:context.doc,row:related.row,item:item});
      if(!details)return {error:result(false,'EDIT_UNAVAILABLE','请先结束官方页面的编辑，再读取。')};
      var recurring=!!details.panel.querySelector('.repeat-info');
      if(!await cancelItemDetails(details)){lastSnapshot=null;return unavailable('details-cancel','未确认官方详情已经关闭，请先在官方页面核对。');}
      if(recurring){lastSnapshot=null;return unavailable('recurrence','重复事项或其父项请在苹果设备上调整。');}
      var current=itemContext(command),latest=current && hierarchyScope(current);
      if(!latest || latest.fingerprint!==scope.fingerprint)return {error:result(false,'STALE_VIEW','事项层级已变化，请重新核对。')};
    }
    function single(row){var selected=scope.entries.filter(function(entry){return entry.row.getAttribute('aria-selected')==='true';});return selected.length===1 && selected[0].row===row && context.doc.activeElement===row;}
    function key(row,name){assertConnected();row.dispatchEvent(new context.doc.defaultView.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,repeat:false}));}
    assertConnected();scope.grid.focus();key(scope.grid,'Home');
    if(!await until(function(){return single(scope.entries[0].row);},900))return unavailable('selection-start','无法核对官方单选，请在官方页面调整。');
    var index=scope.entries.findIndex(function(entry){return entry.item.id===command.id;});
    for(var position=1;position<=index;position++){
      key(scope.entries[position-1].row,'ArrowDown');
      if(!await until(function(){return single(scope.entries[position].row);},900))return unavailable('selection-step','选区已变化，请重新读取。');
    }
    var current=itemContext(command),latest=current && hierarchyScope(current);
    return latest && latest.fingerprint===scope.fingerprint && single(context.row)?{context:context,scope:scope,plan:plan,single:function(){return single(context.row);}}:{error:result(false,'STALE_VIEW','事项或选区已变化，请先刷新。')};
  }

  async function getSubtaskInfo(command) {
    if(!['indent','outdent'].includes(command.direction))return result(false,'INVALID_COMMAND','请选择缩进或提升事项。');
    var prepared=await prepareSubtask(command);if(prepared.error)return prepared.error;
    var refreshed=read();if(!refreshed.ok)return refreshed;
    return result(true,'SUBTASK_READY','请确认层级调整的影响。',{snapshot:refreshed.snapshot,subtask:{direction:command.direction,parentTitle:prepared.plan.parent.title,
      affectedTitles:prepared.plan.affectedTitles,affectedCount:prepared.plan.affectedTitles.length,hierarchyFingerprint:prepared.scope.fingerprint},dispatched:false,cloudConfirmed:false});
  }

  async function setSubtask(command) {
    if(command.confirmed!==true || !['indent','outdent'].includes(command.direction) || typeof command.expectedHierarchyFingerprint!=='string' || !command.expectedHierarchyFingerprint || command.expectedHierarchyFingerprint.length>200000 ||
       typeof command.requestId!=='string' || !/^[a-z0-9-]{1,100}$/.test(command.requestId))return result(false,'INVALID_COMMAND','请先确认事项与所有受影响的子事项。');
    if(hierarchyRequests.has(command.requestId))return result(false,'ALREADY_SUBMITTED','本次层级调整已提交，请先读取核对。');
    if(hierarchyRequests.size>=512)return result(false,'HIERARCHY_LIMIT','本页操作较多，请重新加载后核对。');
    var prepared=await prepareSubtask(command);if(prepared.error)return prepared.error;
    if(prepared.scope.fingerprint!==command.expectedHierarchyFingerprint || !prepared.single())return result(false,'STALE_VIEW','确认后层级或内容已变化，请重新读取。');
    hierarchyRequests.add(command.requestId);lastSnapshot=null;
    var mac=/mac/i.test(root.navigator.platform || '');
    assertConnected();
    prepared.context.row.dispatchEvent(new prepared.context.doc.defaultView.KeyboardEvent('keydown',{key:command.direction==='indent'?']':'[',bubbles:true,cancelable:true,ctrlKey:!mac,metaKey:mac,shiftKey:false,altKey:false,repeat:false}));
    var observed=await until(function(){
      var refreshed=read();if(!refreshed.ok || refreshed.snapshot.pageId!==command.pageId || refreshed.snapshot.activeListId!==command.listId)return false;
      var current=itemContext({...command,fingerprint:refreshed.snapshot.items.find(function(item){return item.id===command.id;})?.fingerprint}),scope=current && hierarchyScope(current);
      if(!scope || scope.entries.length!==prepared.scope.entries.length)return false;
      return scope.entries.every(function(entry,index){return entry.item.id===prepared.scope.entries[index].item.id && hierarchyContent(entry.item)===hierarchyContent(prepared.scope.entries[index].item) && entry.item.parentId===prepared.plan.parents[index].parentId;})?refreshed:false;
    },2600);
    if(!observed){lastSnapshot=null;return result(false,'UNCERTAIN_WRITE','层级结果尚未准确确认，请先读取核对，不要重复提交。',{dispatched:true,cloudConfirmed:false});}
    return result(true,'WEB_STATE_OBSERVED','网页层级已调整；云端保存仍需核对。',{snapshot:observed.snapshot,dispatched:true,cloudConfirmed:false});
  }

  root.__suixingAdapter = {
    version: '0.3.26',
    dispose:function(){clearSettledCreation();root.removeEventListener('offline',lostConnection);},
    invalidateConnection:lostConnection,
    /** 对外仅提供固定命令，不接受任意脚本、接口地址或登录信息。 */
    execute: async function (command) {
      if (inFlight) return result(false, 'BUSY', '上一项操作尚未结束。');
      if (!command || !['read','readLists','readList', 'selectList', 'showCompleted', 'getSchedule', 'getDeleteInfo', 'deleteItem', 'getListCreateOptions', 'createList', 'renameList','deleteList','getListAppearance','setListAppearance','getSubtaskInfo','setSubtask', 'setSchedule', 'setFlagged', 'setCompleted', 'setText', 'createItem'].includes(command.type)) return result(false, 'INVALID_COMMAND', '不支持的操作。');
      var writing=['setCompleted','setText','createItem','setSchedule','setFlagged','deleteItem','createList','renameList','deleteList','setListAppearance','setSubtask'].includes(command.type);
      // 日期确认会把官方焦点还给刚新增的标题。仅同一行的日期操作可保留原只读凭据。
      var sameCreationSchedule=command.type==='setSchedule' && settledCreation && command.pageId===pageId &&
        command.listId===settledCreation.listId && command.id===settledCreation.id;
      var scheduleConfirmed=false;
      if(writing && !sameCreationSchedule)clearSettledCreation();
      if(root.navigator.onLine===false){lostConnection();return result(false,'OFFLINE','网络已断开，保留上次读取内容；恢复连接后请刷新。',{dispatched:false,cloudConfirmed:false});}
      inFlight = true;
      operationEpoch=connectionEpoch;
      if (command.type === 'createItem') { creationDiagnosticSequence = root.__suixingDiagnosticWriteSequence; setCreationStage('preflight'); }
      try {
        if (command.type === 'read') return await read(command);
        if (command.type === 'readLists') return await readLists(command);
        if (command.type === 'readList') return readSelectedList(command);
        if (command.type === 'selectList') return await selectList(command);
        if (command.type === 'showCompleted') return await showCompleted(command);
        if (command.type === 'getSchedule') return await getSchedule(command);
        if (command.type === 'getDeleteInfo') return await getDeleteInfo(command);
        if (command.type === 'deleteItem') return await deleteItem(command);
        if (command.type === 'getSubtaskInfo')return await getSubtaskInfo(command);
        if (command.type === 'setSubtask')return await setSubtask(command);
        if (command.type === 'getListCreateOptions')return await getListCreateOptions(command);
        if (['createList','renameList'].includes(command.type)) return await changeList(command);
        if (command.type === 'deleteList') return await deleteList(command);
        if (['getListAppearance','setListAppearance'].includes(command.type))return await listAppearance(command,command.type==='setListAppearance');
        if (command.type === 'setSchedule') {
          var savedSchedule=await setSchedule(command);
          scheduleConfirmed=savedSchedule.ok && ['WEB_STATE_OBSERVED','UNCHANGED'].includes(savedSchedule.code);
          return savedSchedule;
        }
        if (command.type === 'setFlagged') return await setFlagged(command);
        if (command.type === 'setText') return await setText(command);
        if (command.type === 'createItem') return await createItem(command);
        return await setCompleted(command);
      } catch (_) {
        lastSnapshot = null;
        if(_?.message==='SUIXING_OFFLINE') return result(false,writing?'UNCERTAIN_WRITE':'OFFLINE',writing?'网络中断，修改结果尚未确认；请联网后读取核对，不要重复提交。':'网络已断开，恢复连接后请刷新。',{cloudConfirmed:false,dispatched:writing?undefined:false});
        return result(false, ['setCompleted', 'setText', 'createItem', 'setSchedule', 'setFlagged', 'deleteItem', 'createList', 'renameList','deleteList','setListAppearance','setSubtask'].includes(command.type) ? 'UNCERTAIN_WRITE' : 'PAGE_CHANGED', '页面结构已变化，请在官方页面核对后重新读取。', { cloudConfirmed: false, stage: command.type === 'createItem' ? creationStage : undefined });
      } finally {
        if(sameCreationSchedule && !scheduleConfirmed)clearSettledCreation();
        inFlight = false;
      }
    }
  };
})(window);
