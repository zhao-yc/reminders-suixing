const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const { clickTestCompletion, editTestText, createTestItem, showTestCompleted, editTestSchedule, verifyTestSorting, clickTestFlag, reconnectTestClient, deleteTestItem, editTestList, deleteTestList, selectTestListClient } = require('./verification-ui.cjs');

const TEST_PREFIX = '随行验证';
const TEST_LIST = '随行验证（2026-11-04）';
const TEST_MANAGEMENT_LIST = '随行验证 · Windows 清单管理验证';
const TEST_MANAGEMENT_RENAMED = '随行验证 · Windows 清单管理验证 · 重命名';
const TEST_ITEM = '随行验证 · 最小读写验证';
const TEST_EDITED_ITEM = '随行验证 · 最小读写验证 · 编辑验证';
const TEST_NOTE = '随行验证 · 备注写入验证\n随行验证 · 第二行';
const TEST_CREATED_ITEM = '随行验证 · Windows 新增验证';
const TEST_SYNC_ITEM = '随行验证 · Windows 同步验证';
const TEST_DELETE_ITEM = '随行验证 · Windows 删除验证';

/** 固定验收命令的中断分类；新增命令不能把可能已写入的异常降为普通失败。 */
function isWriteTestCommand(command) {
  return ['delete-management-test-list','create-management-test-list','rename-management-test-list','restore-management-test-list','create-delete-test-item','delete-test-item','create-sync-test-item','flag-sync-test-item','unflag-sync-test-item','flag-created-test-item','unflag-created-test-item','complete-test-item','uncomplete-test-item','edit-test-title','restore-test-title','edit-test-note','clear-test-note','create-test-item','set-test-date','set-test-time','clear-test-schedule'].includes(command);
}

/** 自动写入只能命中唯一的专用验证清单与验证事项，名称仅用于限定测试范围。实际写入仍使用记录 ID 与指纹。 */
async function testOperation(controller, command, { sendSnapshot, ui }) {
  if(command==='select-test-list-in-client') {
    const navigation=await controller.execute({type:'readLists'},'cn');if(!navigation.ok)return navigation;
    const targets=navigation.snapshot.lists.filter(list=>list.title===TEST_LIST);
    if(targets.length!==1)return {ok:false,code:'TEST_LIST_NOT_UNIQUE'};
    sendSnapshot(navigation);let selected;
    try{selected=await ui.webContents.executeJavaScript('('+selectTestListClient.toString()+')('+JSON.stringify({pageId:navigation.snapshot.pageId,listId:targets[0].id,title:TEST_LIST})+')',true);}catch{return {ok:false,code:'TEST_LIST_SELECTION_UNCONFIRMED'};}
    if(!selected)return {ok:false,code:'TEST_LIST_SELECTION_UNCONFIRMED'};
    const result=await controller.execute({type:'read'},'cn');
    return result.ok && result.snapshot.activeListId===targets[0].id?{...result,via:'Windows 本地侧栏选择及正式读取 IPC'}:{ok:false,code:'TEST_LIST_SELECTION_UNCONFIRMED'};
  }
  let result = await controller.execute({ type: 'read' }, 'cn');
  if (!result.ok) return result;
  const lists = result.snapshot.lists.filter(list => list.title===TEST_LIST);
  if (lists.length !== 1) return { ok: false, code: 'TEST_LIST_NOT_UNIQUE' };
  if(['cancel-management-list-delete','delete-management-test-list'].includes(command)) {
    const targets=result.snapshot.lists.filter(list=>list.title===TEST_MANAGEMENT_LIST);
    if(targets.length!==1 || result.snapshot.activeListId!==targets[0].id || result.snapshot.items.length) return {ok:false,code:'TEST_EMPTY_MANAGEMENT_REQUIRED'};
    const target=targets[0],others=result.snapshot.lists.filter(list=>list.id!==target.id).map(list=>list.fingerprint);
    sendSnapshot(result);let clicked;
    try{clicked=await ui.webContents.executeJavaScript('('+deleteTestList.toString()+')('+JSON.stringify({pageId:result.snapshot.pageId,listId:target.id,title:TEST_MANAGEMENT_LIST,cancel:command==='cancel-management-list-delete'})+')',true);}catch{return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};}
    if(!clicked)return {ok:false,code:'TEST_LIST_DELETE_UNCONFIRMED'};
    if(command==='cancel-management-list-delete') {
      const current=await controller.execute({type:'read'},'cn');
      const same=current.ok && current.snapshot.activeListId===target.id && JSON.stringify(current.snapshot.lists.map(list=>list.fingerprint))===JSON.stringify(result.snapshot.lists.map(list=>list.fingerprint));
      return same?{...current,code:'TEST_LIST_DELETE_CANCELLED',dispatched:false}:{ok:false,code:'TEST_LIST_DELETE_UNCONFIRMED'};
    }
    for(let attempt=0;attempt<90;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,200));const current=await controller.execute({type:'readLists'},'cn');
      if(current.ok && current.snapshot.pageId===result.snapshot.pageId && !current.snapshot.lists.some(list=>list.id===target.id) && JSON.stringify(current.snapshot.lists.map(list=>list.fingerprint))===JSON.stringify(others)) return {...current,code:'WEB_STATE_OBSERVED',dispatched:true,cloudConfirmed:false,via:'Windows 本地清单删除确认 IPC'};
    }
    return {ok:false,code:'UNCERTAIN_WRITE',dispatched:true,cloudConfirmed:false};
  }
  if(['select-management-test-list','cancel-management-list-create','create-management-test-list','rename-management-test-list','restore-management-test-list'].includes(command)) {
    const managed=result.snapshot.lists.filter(list=>[TEST_MANAGEMENT_LIST,TEST_MANAGEMENT_RENAMED].includes(list.title));
    if(managed.length>1) return {ok:false,code:'TEST_MANAGEMENT_NOT_UNIQUE'};
    if(command==='select-management-test-list') return managed.length===1?controller.execute({type:'selectList',pageId:result.snapshot.pageId,listId:managed[0].id},'cn'):{ok:false,code:'TEST_MANAGEMENT_NOT_FOUND'};
    const creating=['create-management-test-list','cancel-management-list-create'].includes(command),value=command==='rename-management-test-list'?TEST_MANAGEMENT_RENAMED:TEST_MANAGEMENT_LIST;
    if(creating && managed.length) return {...result,code:'UNCHANGED',dispatched:false};
    const selected=creating?lists[0]:managed[0];
    if(!selected || result.snapshot.activeListId!==selected.id || !creating && result.snapshot.items.length || result.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX))) return {ok:false,code:'TEST_MANAGEMENT_SCOPE_REQUIRED'};
    if(!creating && selected.title===value) return {...result,code:'UNCHANGED',dispatched:false};
    sendSnapshot(result);await new Promise(resolve=>setTimeout(resolve,120));let clicked;
    try {clicked=await ui.webContents.executeJavaScript('('+editTestList.toString()+')('+JSON.stringify({pageId:result.snapshot.pageId,listId:selected.id,title:selected.title,operation:creating?'create':'rename',value,cancel:command==='cancel-management-list-create'})+')',true);}
    catch {return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};}
    if(!clicked) return {ok:false,code:'TEST_LIST_UI_UNCONFIRMED'};
    if(command==='cancel-management-list-create') {
      const current=await controller.execute({type:'read'},'cn');
      const same=current.ok && current.snapshot.pageId===result.snapshot.pageId && current.snapshot.activeListId===selected.id &&
        JSON.stringify(current.snapshot.lists.map(list=>list.fingerprint))===JSON.stringify(result.snapshot.lists.map(list=>list.fingerprint)) && JSON.stringify(current.snapshot.items.map(item=>item.fingerprint))===JSON.stringify(result.snapshot.items.map(item=>item.fingerprint));
      return same?{...current,code:'TEST_LIST_EDITOR_CANCELLED',dispatched:false}:{ok:false,code:'TEST_LIST_UI_UNCONFIRMED'};
    }
    for(let attempt=0;attempt<90;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,200));const current=await controller.execute({type:'read'},'cn');
      const matches=current.snapshot?.lists.filter(list=>list.title===value);
      if(current.ok && current.snapshot.pageId===result.snapshot.pageId && matches.length===1 && current.snapshot.activeListId===matches[0].id && current.snapshot.items.length===0 &&
        (creating?!result.snapshot.lists.some(list=>list.id===matches[0].id):matches[0].id===selected.id)) return {...current,code:'WEB_STATE_OBSERVED',dispatched:true,cloudConfirmed:false,via:'Windows 本地清单名称编辑器 IPC'};
    }
    return {ok:false,code:'UNCERTAIN_WRITE',dispatched:true,cloudConfirmed:false};
  }
  if (command === 'select-test-list') {
    return controller.execute({ type: 'selectList', pageId: result.snapshot.pageId, listId: lists[0].id }, 'cn');
  }
  if (result.snapshot.activeListId !== lists[0].id) return { ok: false, code: 'TEST_LIST_NOT_SELECTED' };
  if(['cancel-delete-test-item','delete-test-item'].includes(command)) {
    if(result.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX))) return {ok:false,code:'TEST_ITEMS_REQUIRED'};
    const targets=result.snapshot.items.filter(item=>item.title===TEST_DELETE_ITEM);
    if(targets.length!==1) return {ok:false,code:'TEST_DELETE_NOT_UNIQUE'};
    const item=targets[0],others=result.snapshot.items.filter(candidate=>candidate.id!==item.id).map(candidate=>candidate.fingerprint);
    if(item.completed || item.notes || item.flagged!==false || item.schedule?.date!==null || item.schedule.time!==null) return {ok:false,code:'TEST_DELETE_STATE_UNSUPPORTED'};
    sendSnapshot(result);await new Promise(resolve=>setTimeout(resolve,120));
    let clicked;
    try {clicked=await ui.webContents.executeJavaScript('('+deleteTestItem.toString()+')('+JSON.stringify({pageId:result.snapshot.pageId,listId:item.listId,id:item.id,title:TEST_DELETE_ITEM,cancel:command==='cancel-delete-test-item'})+')',true);}
    catch {return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};}
    if(!clicked) return {ok:false,code:'TEST_DELETE_UI_UNCONFIRMED'};
    if(command==='cancel-delete-test-item') {
      const current=await controller.execute({type:'read'},'cn');
      const same=current.ok && JSON.stringify(current.snapshot.items.map(candidate=>candidate.fingerprint))===JSON.stringify(result.snapshot.items.map(candidate=>candidate.fingerprint));
      return same?{...current,code:'TEST_DELETE_CANCELLED',dispatched:false}:{ok:false,code:'TEST_DELETE_UI_UNCONFIRMED'};
    }
    for(let attempt=0;attempt<90;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,200));const current=await controller.execute({type:'read'},'cn');
      if(current.ok && current.snapshot.pageId===result.snapshot.pageId && current.snapshot.activeListId===item.listId && !current.snapshot.items.some(candidate=>candidate.id===item.id) &&
         JSON.stringify(current.snapshot.items.map(candidate=>candidate.fingerprint))===JSON.stringify(others)) return {...current,code:'WEB_STATE_OBSERVED',dispatched:true,cloudConfirmed:false,via:'Windows 本地删除预检与确认界面 IPC'};
    }
    return {ok:false,code:'UNCERTAIN_WRITE',dispatched:true,cloudConfirmed:false};
  }
  if(command==='inspect-sync-delete') {
    if(result.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX))) return {ok:false,code:'TEST_ITEMS_REQUIRED'};
    const targets=result.snapshot.items.filter(item=>item.title===TEST_SYNC_ITEM);
    if(targets.length!==1) return {ok:false,code:'TEST_ITEM_NOT_UNIQUE'};
    const item=targets[0];
    return controller.execute({type:'getDeleteInfo',pageId:result.snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed},'cn');
  }
  if(command==='reconnect-test-client') {
    if(!result.snapshot.items.length || result.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX))) return {ok:false,code:'TEST_ITEMS_REQUIRED'};
    sendSnapshot(result);await new Promise(resolve=>setTimeout(resolve,120));
    let connected;
    try {connected=await ui.webContents.executeJavaScript('('+reconnectTestClient.toString()+')('+JSON.stringify({pageId:result.snapshot.pageId,listId:lists[0].id,title:lists[0].title,details:true})+')',true);}
    catch {return {ok:false,code:'TEST_RECONNECT_UNCONFIRMED'};}
    if(connected!==true) return {ok:false,code:'TEST_RECONNECT_UNCONFIRMED',reason:['UI_NOT_READY','UI_ERROR','VIEW_NOT_RESTORED','OBSERVATION_TIMEOUT'].includes(connected?.reason)?connected.reason:'OTHER',kind:['RECONNECT_FAILED','PAGE_NOT_READY','BUSY','STALE_VIEW','NAVIGATION_FAILED','NAVIGATION_TIMEOUT','OTHER'].includes(connected?.kind)?connected.kind:undefined};
    const after=await controller.execute({type:'read'},'cn');
    if(!after.ok || after.snapshot.pageId===result.snapshot.pageId || after.snapshot.activeListTitle!==lists[0].title) return {ok:false,code:'TEST_RECONNECT_UNCONFIRMED'};
    return {...after,code:'CLIENT_RECONNECTED',via:'Windows 本地重新连接按钮 IPC'};
  }
  if (['show-test-site','hide-test-site','reopen-test-site'].includes(command)) {
    if(!result.snapshot.items.length || result.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX))) return {ok:false,code:'TEST_ITEMS_REQUIRED'};
    if(command==='reopen-test-site')sendSnapshot({ok:false,code:'PAGE_CHANGED',message:'官方页面正在重新打开，请稍后读取。'});
    return controller.inspectSiteConnection({'show-test-site':'show','hide-test-site':'hide','reopen-test-site':'reopen'}[command]);
  }
  if (['flag-created-test-item','unflag-created-test-item','flag-sync-test-item','unflag-sync-test-item'].includes(command)) {
    const title=command.includes('sync-')?TEST_SYNC_ITEM:TEST_CREATED_ITEM;
    const created=result.snapshot.items.filter(item=>item.title===title);
    if(created.length!==1) return {ok:false,code:'TEST_CREATED_NOT_UNIQUE'};
    const item=created[0],flagged=command.startsWith('flag-');
    if(typeof item.flagged!=='boolean' || item.schedule?.date!==null || item.schedule.time!==null || item.completed) return {ok:false,code:'TEST_CREATED_STATE_UNSUPPORTED'};
    if(item.flagged===flagged) return {...result,code:'UNCHANGED',dispatched:false};
    sendSnapshot(result);
    let clicked;
    try {clicked=await ui.webContents.executeJavaScript('('+clickTestFlag.toString()+')('+JSON.stringify({pageId:result.snapshot.pageId,listId:item.listId,id:item.id,completed:item.completed,flagged:item.flagged})+')',true);}
    catch {return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};}
    if(!clicked) return {ok:false,code:'TEST_UI_NOT_READY'};
    for(let attempt=0;attempt<70;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,200));result=await controller.execute({type:'read'},'cn');
      const actual=result.snapshot?.items.find(candidate=>candidate.id===item.id);
      if(actual?.flagged===flagged) return {...result,code:'WEB_STATE_OBSERVED',dispatched:true,cloudConfirmed:false,via:'Windows 本地旗标按钮 IPC'};
    }
    return {ok:false,code:'UNCERTAIN_WRITE',dispatched:true,cloudConfirmed:false};
  }
  if (command === 'verify-test-sorting') {
    if (!result.snapshot.items.length || result.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX))) return {ok:false,code:'TEST_ITEMS_REQUIRED'};
    sendSnapshot(result);
    await new Promise(resolve=>setTimeout(resolve,120));
    let observed=false;
    try {observed=await ui.webContents.executeJavaScript('('+verifyTestSorting.toString()+')('+JSON.stringify({pageId:result.snapshot.pageId,listId:lists[0].id,ids:result.snapshot.items.map(item=>item.id),priorities:result.snapshot.items.map(item=>({id:item.id,priority:item.priority}))})+')',true);}
    catch {return {ok:false,code:'TEST_SORTING_UNCONFIRMED'};}
    const after=await controller.execute({type:'read'},'cn');
    const unchanged=after.ok && JSON.stringify(after.snapshot.items.map(item=>item.fingerprint))===JSON.stringify(result.snapshot.items.map(item=>item.fingerprint));
    return {ok:observed && unchanged,code:observed && unchanged?'TEST_SORTING_OBSERVED':'TEST_SORTING_UNCONFIRMED',restored:observed,webItemsUnchanged:unchanged};
  }
  if (['create-test-item','create-sync-test-item','create-delete-test-item'].includes(command)) {
    const title=command==='create-delete-test-item'?TEST_DELETE_ITEM:command==='create-sync-test-item'?TEST_SYNC_ITEM:TEST_CREATED_ITEM;
    const existing = result.snapshot.items.filter(item => item.title === title);
    if (existing.length > 1) return { ok:false, code:'TEST_CREATED_NOT_UNIQUE' };
    if (existing.length === 1) return { ...result, code:'UNCHANGED', dispatched:false };
    sendSnapshot(result);
    let clicked;
    try {
      clicked = await ui.webContents.executeJavaScript('(' + createTestItem.toString() + ')(' + JSON.stringify({ pageId:result.snapshot.pageId, listId:lists[0].id, title }) + ')', true);
    } catch { return { ok:false, code:'UNCERTAIN_WRITE', cloudConfirmed:false }; }
    if (!clicked) return { ok:false, code:'TEST_UI_NOT_READY' };
    for (let attempt=0; attempt<80; attempt++) {
      await new Promise(resolve=>setTimeout(resolve,200));
      result = await controller.execute({type:'read'},'cn');
      if (result.snapshot?.items.filter(item=>item.title===title).length===1) return { ...result, code:'WEB_STATE_OBSERVED', dispatched:true, cloudConfirmed:false, via:'Windows 本地新增界面 IPC' };
    }
    return { ok:false, code:'UNCERTAIN_WRITE', dispatched:true, cloudConfirmed:false };
  }
  if (command === 'show-completed') {
    sendSnapshot(result);
    const shown=await ui.webContents.executeJavaScript('('+showTestCompleted.toString()+')('+JSON.stringify({pageId:result.snapshot.pageId,listId:lists[0].id})+')',true);
    if (!shown) return {ok:false,code:'TEST_VIEW_NOT_READY'};
    return {...await controller.execute({type:'read'},'cn'),via:'Windows 本地已完成页签 IPC'};
  }
  const items = result.snapshot.items.filter(item => [TEST_ITEM, TEST_EDITED_ITEM].includes(item.title));
  if (items.length !== 1) return { ok: false, code: 'TEST_ITEM_NOT_UNIQUE' };
  const item = items[0];
  if (command === 'read-test-schedule') return controller.execute({type:'getSchedule',pageId:result.snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed},'cn');
  if (['set-test-date','set-test-time','clear-test-schedule'].includes(command)) {
    let current=await controller.execute({type:'getSchedule',pageId:result.snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed},'cn');
    if (!current.ok) return current;
    const schedule=current.schedule;
    if (!schedule || !(schedule.date===null && schedule.time===null || schedule.date==='2030-01-15' && [null,'14:35'].includes(schedule.time))) return {ok:false,code:'TEST_SCHEDULE_NOT_OWNED'};
    const value={date:command==='clear-test-schedule'?null:'2030-01-15',time:command==='set-test-time'?'14:35':null,timeZone:command==='set-test-time'?current.editorTimeZone:null};
    if (schedule.date===value.date && schedule.time===value.time && schedule.timeZone===value.timeZone) return {...current,code:'UNCHANGED',dispatched:false};
    sendSnapshot(current);
    let clicked;
    try {clicked=await ui.webContents.executeJavaScript('('+editTestSchedule.toString()+')('+JSON.stringify({pageId:current.snapshot.pageId,listId:item.listId,id:item.id,completed:item.completed,value})+')',true);}
    catch {return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};}
    if (!clicked) return {ok:false,code:'TEST_UI_NOT_READY'};
    for(let attempt=0;attempt<70;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,200));
      result=await controller.execute({type:'read'},'cn');
      const actual=result.snapshot?.items.find(candidate=>candidate.id===item.id);
      if (!actual) continue;
      current=await controller.execute({type:'getSchedule',pageId:result.snapshot.pageId,listId:actual.listId,id:actual.id,fingerprint:actual.fingerprint,expectedCompleted:actual.completed},'cn');
      if (current.schedule?.date===value.date && current.schedule.time===value.time && current.schedule.timeZone===value.timeZone) return {...current,code:'WEB_STATE_OBSERVED',dispatched:true,cloudConfirmed:false,via:'Windows 本地日期编辑界面 IPC'};
    }
    return {ok:false,code:'UNCERTAIN_WRITE',dispatched:true,cloudConfirmed:false};
  }
  if (['edit-test-title', 'restore-test-title', 'edit-test-note', 'clear-test-note'].includes(command)) {
    const field = command.endsWith('title') ? 'title' : 'notes';
    const value = field === 'title' ? (command === 'edit-test-title' ? TEST_EDITED_ITEM : TEST_ITEM) : (command === 'edit-test-note' ? TEST_NOTE : '');
    if (field === 'notes' && !['', TEST_NOTE].includes(item.notes)) return { ok: false, code: 'TEST_NOTE_NOT_OWNED' };
    if (item[field] === value) return { ...result, code: 'UNCHANGED', dispatched: false };
    sendSnapshot(result);
    let clicked;
    try {
      clicked = await ui.webContents.executeJavaScript('(' + editTestText.toString() + ')(' + JSON.stringify({
        pageId: result.snapshot.pageId, listId: item.listId, id: item.id, completed: item.completed, field, value
      }) + ')', true);
    } catch { return { ok: false, code: 'UNCERTAIN_WRITE', cloudConfirmed: false }; }
    if (!clicked) return { ok: false, code: 'TEST_UI_NOT_READY' };
    for (let attempt = 0; attempt < 80; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      result = await controller.execute({ type: 'read' }, 'cn');
      const actual = result.snapshot?.items.find(candidate => candidate.id === item.id);
      if (actual?.[field] === value) return { ...result, code: 'WEB_STATE_OBSERVED', dispatched: true, cloudConfirmed: false, via: 'Windows 本地编辑界面 IPC' };
    }
    return { ok: false, code: 'UNCERTAIN_WRITE', dispatched: true, cloudConfirmed: false };
  }
  const completed = command === 'complete-test-item';
  if (item.completed === completed) return { ...result, code: 'UNCHANGED', dispatched: false };
  // 真实验证走本地界面的完成按钮和受限 IPC；点击只发一次，后续只读核对。
  sendSnapshot(result);
  let clicked;
  try {
    clicked = await ui.webContents.executeJavaScript('(' + clickTestCompletion.toString() + ')(' + JSON.stringify({
      pageId: result.snapshot.pageId, listId: item.listId, id: item.id, completed: item.completed
    }) + ')', true);
  } catch {
    // 渲染器中断可能发生在点击之后，不能当作“没有写入”来自动重放。
    return { ok: false, code: 'UNCERTAIN_WRITE', dispatched: undefined, cloudConfirmed: false };
  }
  if (!clicked) return { ok: false, code: 'TEST_UI_NOT_READY' };
  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    result = await controller.execute({ type: 'read' }, 'cn');
    const actual = result.snapshot?.items.filter(candidate => candidate.title === TEST_ITEM);
    if (actual?.length === 1 && actual[0].completed === completed) {
      return { ...result, code: 'WEB_STATE_OBSERVED', dispatched: true, cloudConfirmed: false, via: 'Windows 本地界面 IPC' };
    }
  }
  return { ok: false, code: 'UNCERTAIN_WRITE', dispatched: true, cloudConfirmed: false };
}

/** 只输出数量及专用测试事项的布尔状态，不把个人清单标题、正文或标识写入日志。 */
function summarize(result) {
  const snapshot = result.snapshot;
  const testList = snapshot?.activeListTitle.startsWith(TEST_PREFIX);
  const items = testList ? snapshot.items.filter(item => [TEST_ITEM, TEST_EDITED_ITEM].includes(item.title)) : [];
  const created = testList ? snapshot.items.filter(item => item.title === TEST_CREATED_ITEM) : [];
  const sync = testList ? snapshot.items.filter(item => item.title === TEST_SYNC_ITEM) : [];
  const deletion = testList ? snapshot.items.filter(item => item.title === TEST_DELETE_ITEM) : [];
  const managed=snapshot?.lists.filter(list=>[TEST_MANAGEMENT_LIST,TEST_MANAGEMENT_RENAMED].includes(list.title)) || [];
  return { ok: result.ok, code: result.code, lists: snapshot?.lists.length, loadedItems: snapshot?.items.length,
    testList, testItemCount: testList ? items.length : undefined, testCompleted: items.length === 1 ? items[0].completed : undefined,
    testOriginalTitle: items.length === 1 ? items[0].title === TEST_ITEM : undefined,
    testEditedTitle: items.length === 1 ? items[0].title === TEST_EDITED_ITEM : undefined,
    testNoteSet: items.length === 1 ? items[0].notes === TEST_NOTE : undefined,
    testNoteEmpty: items.length === 1 ? items[0].notes === '' : undefined,
    testCreatedCount: testList ? created.length : undefined,
    testCreatedPending: created.length === 1 ? !created[0].completed : undefined,
    testCreatedFlagged: created.length === 1 ? created[0].flagged : undefined,
    testSyncCount:testList?sync.length:undefined,
    testSyncPending:sync.length===1?!sync[0].completed:undefined,
    testSyncFlagged:sync.length===1?sync[0].flagged:undefined,
    testSyncPriority:sync.length===1?['none','low','medium','high'].includes(sync[0].priority)?sync[0].priority:null:undefined,
    deleteReady:result.deleteReady===true?true:undefined,
    testDeleteCount:testList?deletion.length:undefined,
    testDeletePending:deletion.length===1?!deletion[0].completed:undefined,
    testManagedListCount:snapshot?managed.length:undefined,
    testManagedListRenamed:managed.length===1?managed[0].title===TEST_MANAGEMENT_RENAMED:undefined,
    testManagementSelected:managed.length===1?snapshot.activeListId===managed[0].id:undefined,
    testManagedLoadedEmpty:managed.length===1 && snapshot.activeListId===managed[0].id?snapshot.items.length===0:undefined,
    navigationOnly:snapshot?.activeListId===null?true:undefined,
    needsListSelection:result.needsListSelection===true?true:undefined,
    testScheduleEmpty: result.schedule ? result.schedule.date === null && result.schedule.time === null : undefined,
    testScheduleDate: result.schedule ? result.schedule.date === '2030-01-15' && result.schedule.time === null : undefined,
    testScheduleTimed: result.schedule ? result.schedule.date === '2030-01-15' && result.schedule.time === '14:35' : undefined,
    dispatched: result.dispatched, cloudConfirmed: result.cloudConfirmed, via: result.via };
}

/** 仅开发验证时通过父进程标准输入收取固定命令，不监听网络端口，也不返回个人数据。 */
function installLiveCheck({ controller, sendSnapshot, quit, directory, ui, environment }) {
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  const commandFile = path.join(directory, 'verification-command.json');
  const resultFile = path.join(directory, 'verification-result.json');
  fs.mkdirSync(directory, { recursive: true });
  fs.rmSync(commandFile, { force: true });
  let busy = false;
  async function run(line, requestId) {
    if (typeof line !== 'string') return;
    const command = line.trim();
    if (!['read-test-lists','select-test-list-in-client','cancel-management-list-delete','delete-management-test-list','inspect-management-list-delete','select-management-test-list','cancel-management-list-create','create-management-test-list','rename-management-test-list','restore-management-test-list','inspect-new-test-list','create-delete-test-item','cancel-delete-test-item','delete-test-item','inspect-sync-delete','open-sync-priority','inspect-sync-priority','cancel-sync-priority','reconnect-test-client','create-sync-test-item','flag-sync-test-item','unflag-sync-test-item','show-test-site','hide-test-site','reopen-test-site','flag-created-test-item', 'unflag-created-test-item', 'environment', 'diagnostics', 'verify-test-sorting', 'inspect-test-editor', 'open-test-details', 'inspect-test-details', 'inspect-test-date-binding', 'preview-test-date','cancel-test-details', 'read-test-schedule', 'set-test-date', 'set-test-time', 'clear-test-schedule', 'read', 'open-sign-in', 'select-test-list', 'show-completed', 'complete-test-item', 'uncomplete-test-item', 'edit-test-title', 'restore-test-title', 'edit-test-note', 'clear-test-note', 'create-test-item', 'reload', 'quit'].includes(command)) return;
    if (command === 'quit') { quit(); return; }
    if (busy) {
      if (requestId) fs.writeFileSync(resultFile, JSON.stringify({ requestId, result: { ok: false, code: 'BUSY' } }));
      return;
    }
    busy = true;
    try {
      let result;
      if (command === 'environment') {
        result={ok:true,packaged:environment?.packaged===true,profileKind:['system-default','project-local'].includes(environment?.profileKind)?environment.profileKind:'unknown'};
      } else if (command === 'open-sign-in') {
        result = await controller.openSignIn();
      } else if (command === 'reload') {
        result = controller.reloadSite('cn');
      } else if (command === 'diagnostics') {
        result = await controller.diagnostics();
      } else if (command === 'inspect-test-editor') {
        result = await controller.inspectTestEditor();
      } else if(command==='inspect-new-test-list') {
        result=await controller.inspectNewTestList();
      } else if(command==='inspect-management-list-delete') {
        result=await controller.inspectTestListDelete();
      } else if(command==='read-test-lists') {
        const navigation=await controller.execute({type:'readLists'},'cn');sendSnapshot(navigation);result=summarize(navigation);
      } else if (command === 'verify-test-sorting') {
        result = await testOperation(controller,command,{sendSnapshot,ui});
      } else if (['open-sync-priority','inspect-sync-priority','cancel-sync-priority','open-test-details','inspect-test-details','inspect-test-date-binding','preview-test-date','cancel-test-details'].includes(command)) {
        result = await controller.inspectTestDetails(command.endsWith('-sync-priority')?command:{'open-test-details':'open','inspect-test-details':'inspect','inspect-test-date-binding':'binding','preview-test-date':'preview-date','cancel-test-details':'cancel'}[command]);
      } else {
        const snapshot = command === 'read' ? await controller.execute({ type: 'read' }, 'cn') : await testOperation(controller, command, { sendSnapshot, ui });
        sendSnapshot(snapshot);
        result = summarize(snapshot);
      }
      if (requestId) fs.writeFileSync(resultFile, JSON.stringify({ requestId, result }, null, 2));
      console.log('开发验证结果：' + JSON.stringify(result));
    } catch {
      const write = isWriteTestCommand(command);
      const result = { ok: false, code: write ? 'UNCERTAIN_WRITE' : 'VERIFICATION_FAILED', cloudConfirmed: false };
      if (requestId) fs.writeFileSync(resultFile, JSON.stringify({ requestId, result }));
      console.log('验证命令未完成，请先只读核对，不重放写入。');
    }
    finally { busy = false; }
  }
  input.on('line', line => run(line));
  // Windows GUI 程序不一定继承标准输入，因此提供只接受固定命令的本地文件信箱。
  fs.watchFile(commandFile, { interval: 500 }, () => {
    try {
      const request = JSON.parse(fs.readFileSync(commandFile, 'utf8'));
      if (typeof request.requestId === 'string' && /^[a-z0-9-]{1,80}$/.test(request.requestId)) {
        fs.rmSync(commandFile, { force: true });
        run(request.command, request.requestId);
      }
    } catch { /* 不完整的文件由下一次修改触发读取。 */ }
  });
  return () => { input.close(); fs.unwatchFile(commandFile); };
}

module.exports = { installLiveCheck, testOperation, summarize, isWriteTestCommand };
