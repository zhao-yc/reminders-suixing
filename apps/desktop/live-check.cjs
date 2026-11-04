const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const { clickTestCompletion, editTestText, createTestItem, showTestCompleted, editTestSchedule, verifyTestSorting, clickTestFlag, reconnectTestClient, deleteTestItem, editTestList, deleteTestList, selectTestListClient, editTestListAppearance, editTestSubtask } = require('./verification-ui.cjs');

const TEST_PREFIX = '随行验证';
const TEST_LIST = '随行验证（2026-11-04）';
const TEST_MANAGEMENT_LIST = '随行验证 · Windows 清单管理验证';
const TEST_MANAGEMENT_RENAMED = '随行验证 · Windows 清单管理验证 · 重命名';
const TEST_APPEARANCE_LIST = '随行验证 · Windows 清单外观验证';
const TEST_ITEM = '随行验证 · 最小读写验证';
const TEST_EDITED_ITEM = '随行验证 · 最小读写验证 · 编辑验证';
const TEST_NOTE = '随行验证 · 备注写入验证\n随行验证 · 第二行';
const TEST_CREATED_ITEM = '随行验证 · Windows 新增验证';
const TEST_SYNC_ITEM = '随行验证 · Windows 同步验证';
const TEST_DELETE_ITEM = '随行验证 · Windows 删除验证';
const TEST_SUBTASK_PARENT = '随行验证 · Windows 子事项父项';
const TEST_SUBTASK_CHILD = '随行验证 · Windows 子事项子项';
const TEST_DATE_ROUNDTRIP_ITEM = '随行验证 · Windows 日期往返验证';
const TEST_DATE_TRANSITION_ITEM = '随行验证 · Windows 日期转换验证';
const DATE_TEST_COMMANDS = new Map();
for (const [name,title,date,time,allDay] of [
  ['date-roundtrip',TEST_DATE_ROUNDTRIP_ITEM,'2031-02-16','10:25',false],
  ['date-transition',TEST_DATE_TRANSITION_ITEM,'2032-03-18','16:45',true]
]) {
  for (const [operation,command] of [['create','create-'+name+'-test-item'],['read','read-'+name+'-test-item'],['time','set-'+name+'-test-time'],['clear','clear-'+name+'-test-time'],['delete','delete-'+name+'-test-item']]) DATE_TEST_COMMANDS.set(command,{operation,title,date,time,allDay});
  if(allDay)DATE_TEST_COMMANDS.set('set-'+name+'-test-day',{operation:'day',title,date,time,allDay});
}

/** 固定验收命令的中断分类；新增命令不能把可能已写入的异常降为普通失败。 */
function isWriteTestCommand(command) {
  if(DATE_TEST_COMMANDS.has(command))return DATE_TEST_COMMANDS.get(command).operation!=='read';
  return ['create-subtask-test-parent','create-subtask-test-child','indent-subtask-test-item','outdent-subtask-test-item','delete-subtask-test-child','delete-subtask-test-parent','create-appearance-test-list','set-appearance-test-style','restore-appearance-test-style','delete-appearance-test-list','delete-management-test-list','create-management-test-list','rename-management-test-list','restore-management-test-list','create-delete-test-item','delete-test-item','create-sync-test-item','flag-sync-test-item','unflag-sync-test-item','flag-created-test-item','unflag-created-test-item','complete-test-item','uncomplete-test-item','edit-test-title','restore-test-title','edit-test-note','clear-test-note','create-test-item','set-test-date','set-test-time','clear-test-schedule'].includes(command);
}

/** 自动写入只能命中唯一的专用验证清单与验证事项，名称仅用于限定测试范围。实际写入仍使用记录 ID 与指纹。 */
async function testOperation(controller, command, { sendSnapshot, ui }) {
  if(['select-test-list-in-client','select-appearance-test-list'].includes(command)) {
    const navigation=await controller.execute({type:'readLists'},'cn');if(!navigation.ok)return navigation;
    const selectedTitle=command==='select-appearance-test-list'?TEST_APPEARANCE_LIST:TEST_LIST;
    const targets=navigation.snapshot.lists.filter(list=>list.title===selectedTitle);
    if(targets.length!==1)return {ok:false,code:'TEST_LIST_NOT_UNIQUE'};
    sendSnapshot(navigation);let selected;
    try{selected=await ui.webContents.executeJavaScript('('+selectTestListClient.toString()+')('+JSON.stringify({pageId:navigation.snapshot.pageId,listId:targets[0].id,title:selectedTitle})+')',true);}catch{return {ok:false,code:'TEST_LIST_SELECTION_UNCONFIRMED'};}
    if(!selected)return {ok:false,code:'TEST_LIST_SELECTION_UNCONFIRMED'};
    const result=await controller.execute({type:'read'},'cn');
    return result.ok && result.snapshot.activeListId===targets[0].id?{...result,via:'Windows 本地侧栏选择及正式读取 IPC'}:{ok:false,code:'TEST_LIST_SELECTION_UNCONFIRMED'};
  }
  let result = await controller.execute({ type: 'read' }, 'cn');
  if (!result.ok) return result;
  const lists = result.snapshot.lists.filter(list => list.title===TEST_LIST);
  if (lists.length !== 1) return { ok: false, code: 'TEST_LIST_NOT_UNIQUE' };
  const dateTest=DATE_TEST_COMMANDS.get(command);
  if (dateTest && dateTest.operation!=='create') {
    if(result.snapshot.activeListId!==lists[0].id || result.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX)))return {ok:false,code:'TEST_SCOPE_REQUIRED'};
    const targets=result.snapshot.items.filter(item=>item.title===dateTest.title);
    if(targets.length!==1)return {ok:false,code:'TEST_DATE_ITEM_NOT_UNIQUE'};
    const target=targets[0],others=result.snapshot.items.filter(item=>item.id!==target.id).map(item=>item.fingerprint);
    if(target.completed || target.notes || target.flagged!==false || target.level!==1)return {ok:false,code:'TEST_DATE_ITEM_NOT_CLEAN'};
    const current=await controller.execute({type:'getSchedule',pageId:result.snapshot.pageId,listId:target.listId,id:target.id,fingerprint:target.fingerprint,expectedCompleted:false},'cn');
    if(!current.ok)return current;
    const state=current.schedule?.date===null && current.schedule.time===null?'empty':current.schedule?.date===dateTest.date?current.schedule.time===dateTest.time && current.schedule.timeZone===current.editorTimeZone?'timed':dateTest.allDay && current.schedule.time===null && current.schedule.timeZone===null?'all-day':'other':'other';
    if(dateTest.operation==='read')return {...current,dateTestState:state,dateTestSource:current.scheduleSource};
    if(state==='other' || dateTest.operation==='day' && state!=='empty' || dateTest.operation==='time' && state!==(dateTest.allDay?'all-day':'empty') || dateTest.operation==='clear' && state!=='timed')return {ok:false,code:'TEST_DATE_STATE_UNSUPPORTED'};
    const deleting=dateTest.operation==='delete',clearing=deleting || dateTest.operation==='clear',timed=dateTest.operation==='time';
    const value={date:clearing?null:dateTest.date,time:timed?dateTest.time:null,timeZone:timed?current.editorTimeZone:null};
    const beforeSequence=controller.lastWriteOutcome()?.sequence || 0;
    sendSnapshot(current);let clicked;
    try{clicked=await ui.webContents.executeJavaScript('('+(deleting?deleteTestItem:editTestSchedule).toString()+')('+JSON.stringify({pageId:current.snapshot.pageId,listId:target.listId,id:target.id,title:dateTest.title,completed:false,value})+')',true);}catch{return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};}
    if(!clicked)return {ok:false,code:'TEST_DATE_UI_UNCONFIRMED'};
    for(let attempt=0;attempt<70;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,150));
      const outcome=controller.lastWriteOutcome();
      if(!outcome || outcome.sequence<=beforeSequence || outcome.replyPending)continue;
      if(!outcome.ok)return {ok:false,code:outcome.code,dispatched:outcome.dispatched,cloudConfirmed:false};
      const after=await controller.execute({type:'readList',pageId:current.snapshot.pageId,listId:target.listId},'cn');if(!after.ok)return after;
      if(!others.every(fingerprint=>after.snapshot.items.some(item=>item.fingerprint===fingerprint)))return {ok:false,code:'TEST_DATE_OTHER_ITEMS_CHANGED'};
      const actual=after.snapshot.items.find(item=>item.id===target.id);
      if(deleting)return !actual?{...after,code:'WEB_STATE_OBSERVED',dispatched:true,cloudConfirmed:false,via:'Windows 本地日期专项删除确认 IPC'}:{ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
      if(!actual)return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
      const schedule=await controller.execute({type:'getSchedule',pageId:after.snapshot.pageId,listId:actual.listId,id:actual.id,fingerprint:actual.fingerprint,expectedCompleted:false},'cn');
      if(schedule.ok && JSON.stringify(schedule.schedule)===JSON.stringify(value))return {...schedule,code:'WEB_STATE_OBSERVED',dateTestState:value.date===null?'empty':value.time===null?'all-day':'timed',dateTestSource:schedule.scheduleSource,dispatched:true,cloudConfirmed:false,via:'Windows 本地日期往返编辑 IPC'};
      return {ok:false,code:'UNCERTAIN_WRITE',dispatched:true,cloudConfirmed:false};
    }
    return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
  }
  if(['create-appearance-test-list','read-appearance-test-style','cancel-appearance-test-edit','set-appearance-test-style','restore-appearance-test-style','delete-appearance-test-list'].includes(command)) {
    const matches=result.snapshot.lists.filter(list=>list.title===TEST_APPEARANCE_LIST),creating=command==='create-appearance-test-list';
    if(creating && matches.length)return {...result,code:'UNCHANGED',dispatched:false};
    const target=creating?lists[0]:matches.length===1?matches[0]:null;
    if(!target || result.snapshot.activeListId!==target.id || !creating && result.snapshot.items.length || creating && result.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX)))return {ok:false,code:'TEST_APPEARANCE_SCOPE_REQUIRED'};
    sendSnapshot(result);let expected;
    if(creating)expected={pageId:result.snapshot.pageId,listId:target.id,title:target.title,operation:'create',value:TEST_APPEARANCE_LIST};
    else if(command==='delete-appearance-test-list')expected={pageId:result.snapshot.pageId,listId:target.id,title:TEST_APPEARANCE_LIST};
    else {
      const view=await controller.execute({type:'getListAppearance',pageId:result.snapshot.pageId,listId:target.id,expectedListFingerprint:target.fingerprint},'cn');
      if(!view.ok)return view;const a=view.appearance;
      if(a.colors.length!==12 || a.icons.length!==72 || a.colors[5].key!=='rgb(0, 122, 255)' || a.colors[1].key!=='rgb(255, 149, 0)')return {ok:false,code:'TEST_APPEARANCE_OPTIONS_CHANGED'};
      const original=a.color===a.colors[5].key && a.iconKey===a.icons[0].key,changed=a.color===a.colors[1].key && a.iconKey===a.icons[7].key;
      if(command==='read-appearance-test-style')return {...result,code:'TEST_APPEARANCE_READ',appearanceStyle:original?'original':changed?'changed':'other',dispatched:false};
      const restore=command==='restore-appearance-test-style';
      if(restore && !changed || !restore && !original)return {ok:false,code:'TEST_APPEARANCE_STATE_UNSUPPORTED'};
      expected={pageId:result.snapshot.pageId,listId:target.id,title:TEST_APPEARANCE_LIST,color:a.colors[restore?5:1].key,iconKey:a.icons[restore?0:7].key,cancel:command==='cancel-appearance-test-edit'};
    }
    let clicked;try{clicked=await ui.webContents.executeJavaScript('('+(creating?editTestList:command==='delete-appearance-test-list'?deleteTestList:editTestListAppearance).toString()+')('+JSON.stringify(expected)+')',true);}catch{return {ok:false,code:isWriteTestCommand(command)?'UNCERTAIN_WRITE':'VERIFICATION_FAILED',cloudConfirmed:false};}
    if(!clicked)return {ok:false,code:'TEST_APPEARANCE_UI_UNCONFIRMED'};
    if(command==='cancel-appearance-test-edit')return {...result,code:'TEST_APPEARANCE_CANCELLED',dispatched:false};
    for(let attempt=0;attempt<90;attempt++){
      await new Promise(resolve=>setTimeout(resolve,200));const current=await controller.execute({type:command==='delete-appearance-test-list'?'readLists':'read'},'cn');if(!current.ok)continue;
      const found=current.snapshot.lists.filter(list=>list.title===TEST_APPEARANCE_LIST);
      const observed=command==='delete-appearance-test-list'?!found.length && current.snapshot.lists.length===result.snapshot.lists.length-1:found.length===1 && current.snapshot.activeListId===found[0].id && current.snapshot.items.length===0 && (creating?!result.snapshot.lists.some(list=>list.id===found[0].id):found[0].id===target.id && found[0].color===expected.color && found[0].icon?.key===expected.iconKey);
      if(observed && result.snapshot.lists.filter(list=>creating || list.id!==target.id).every(old=>current.snapshot.lists.some(list=>list.fingerprint===old.fingerprint)))return {...current,code:'WEB_STATE_OBSERVED',dispatched:true,cloudConfirmed:false,via:'Windows 本地清单外观专项 IPC'};
    }
    return {ok:false,code:'UNCERTAIN_WRITE',dispatched:true,cloudConfirmed:false};
  }
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
  if(['create-subtask-test-parent','create-subtask-test-child','read-subtask-test-state','cancel-subtask-test-indent','indent-subtask-test-item','outdent-subtask-test-item','delete-subtask-test-child','delete-subtask-test-parent'].includes(command)){
    if(result.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX)))return {ok:false,code:'TEST_ITEMS_REQUIRED'};
    const parents=result.snapshot.items.filter(item=>item.title===TEST_SUBTASK_PARENT),children=result.snapshot.items.filter(item=>item.title===TEST_SUBTASK_CHILD);
    if(parents.length>1 || children.length>1)return {ok:false,code:'TEST_SUBTASK_NOT_UNIQUE'};
    const namedParent=parents[0],namedChild=children[0],ordered=result.snapshot.items.filter(item=>[TEST_SUBTASK_PARENT,TEST_SUBTASK_CHILD].includes(item.title));
    // 顶栏新增可能插在头部；测试名称只限定归属，按官方实际顺序识别这两条的父/子角色。
    const parent=ordered.length===2?ordered[0]:namedParent,child=ordered.length===2?ordered[1]:namedChild,clean=item=>item && item.completed===false && item.notes==='' && item.flagged===false && item.schedule?.date===null && item.schedule.time===null;
    const state=parent && child?child.level===2 && child.parentId===parent.id && parent.level===1?'nested':parent.level===1 && child.level===1?'flat':'other':!parent && !child?'none':'partial';
    if(command==='read-subtask-test-state')return {...result,code:'SUBTASK_TEST_READ',subtaskState:state,subtaskOrder:ordered.length===2?ordered[0].title===TEST_SUBTASK_PARENT?'parent-first':'child-first':'partial',dispatched:false};
    const creating=command.startsWith('create-'),deleting=command.startsWith('delete-'),parentTarget=command.endsWith('-parent'),target=creating || deleting?parentTarget?namedParent:namedChild:child;
    if(creating && target)return {...result,code:'UNCHANGED',dispatched:false};
    if(creating && parentTarget && namedChild)return {ok:false,code:'TEST_SUBTASK_STATE_UNSUPPORTED'};
    if(creating && !parentTarget && (!clean(namedParent) || namedParent.level!==1))return {ok:false,code:'TEST_SUBTASK_PARENT_REQUIRED'};
    if(!creating && (!clean(target) || !deleting && (!clean(parent) || !clean(child)) || deleting && (target.level!==1 || parentTarget && !!namedChild)))return {ok:false,code:'TEST_SUBTASK_STATE_UNSUPPORTED'};
    if(!creating && !deleting && (command==='outdent-subtask-test-item'?state!=='nested':state!=='flat'))return {ok:false,code:'TEST_SUBTASK_STATE_UNSUPPORTED'};
    const others=result.snapshot.items.filter(item=>creating || deleting?item.id!==target?.id:![parent.id,child.id].includes(item.id)).map(item=>item.fingerprint);
    let expected={pageId:result.snapshot.pageId,listId:result.snapshot.activeListId};
    if(creating)expected={...expected,title:parentTarget?TEST_SUBTASK_PARENT:TEST_SUBTASK_CHILD};
    else if(deleting)expected={...expected,id:target.id,title:target.title};
    else {
      const info=await controller.execute({type:'getSubtaskInfo',...expected,id:child.id,fingerprint:child.fingerprint,expectedCompleted:false,direction:command==='outdent-subtask-test-item'?'outdent':'indent'},'cn');
      if(!info.ok)return info;if(info.subtask.parentTitle!==parent.title || info.subtask.affectedCount!==1)return {ok:false,code:'TEST_SUBTASK_PLAN_UNSUPPORTED'};
      result=info;expected={...expected,id:child.id,title:child.title,cancel:command==='cancel-subtask-test-indent'};
    }
    sendSnapshot(result);await new Promise(resolve=>setTimeout(resolve,120));let clicked;
    try{clicked=await ui.webContents.executeJavaScript('('+(creating?createTestItem:deleting?deleteTestItem:editTestSubtask).toString()+')('+JSON.stringify(expected)+')',true);}catch{return {ok:false,code:isWriteTestCommand(command)?'UNCERTAIN_WRITE':'VERIFICATION_FAILED',cloudConfirmed:false};}
    if(!clicked)return {ok:false,code:'TEST_SUBTASK_UI_UNCONFIRMED'};
    if(command==='cancel-subtask-test-indent')return {...result,code:'SUBTASK_TEST_CANCELLED',dispatched:false};
    for(let attempt=0;attempt<90;attempt++){
      await new Promise(resolve=>setTimeout(resolve,200));const current=await controller.execute({type:'read'},'cn');if(!current.ok || current.snapshot.activeListId!==expected.listId)continue;
      const p=current.snapshot.items.find(item=>item.id===parent?.id),c=current.snapshot.items.find(item=>item.id===child?.id),observed=creating?current.snapshot.items.filter(item=>item.title===expected.title).length===1:deleting?!current.snapshot.items.some(item=>item.id===target.id):clean(p) && clean(c) && (command==='outdent-subtask-test-item'?c.level===1 && c.parentId===null:c.level===2 && c.parentId===p.id);
      if(observed && others.every(fingerprint=>current.snapshot.items.some(item=>item.fingerprint===fingerprint)))return {...current,code:'WEB_STATE_OBSERVED',dispatched:true,cloudConfirmed:false,via:'Windows 本地子事项专项 IPC'};
    }
    return {ok:false,code:'UNCERTAIN_WRITE',dispatched:true,cloudConfirmed:false};
  }
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
    catch {return {ok:false,code:'TEST_RECONNECT_UNCONFIRMED',reason:'UI_EXECUTION_FAILED'};}
    if(connected!==true) return {ok:false,code:'TEST_RECONNECT_UNCONFIRMED',reason:['UI_NOT_READY','UI_ERROR','VIEW_NOT_RESTORED','OBSERVATION_TIMEOUT'].includes(connected?.reason)?connected.reason:'OTHER',stage:['home','reminders','opening','waiting-navigation','selecting-list','waiting-selected'].includes(connected?.stage)?connected.stage:undefined,kind:['OFFICIAL_PAGE_BUSY','RECONNECT_FAILED','PAGE_NOT_READY','BUSY','STALE_VIEW','RECONNECT_TIMEOUT','NAVIGATION_FAILED','NAVIGATION_TIMEOUT','BRIDGE_TIMEOUT','OTHER'].includes(connected?.kind)?connected.kind:undefined};
    const known=code=>['PAGE_NOT_READY','LIST_LOADING','BUSY','STALE_VIEW','BRIDGE_TIMEOUT'].includes(code)?code:'OTHER';
    const navigation=await controller.execute({type:'readLists'},'cn');
    if(!navigation.ok)return {ok:false,code:'TEST_RECONNECT_UNCONFIRMED',reason:'AFTER_NAVIGATION_READ_FAILED',kind:known(navigation.code)};
    if(navigation.snapshot.pageId===result.snapshot.pageId)return {ok:false,code:'TEST_RECONNECT_UNCONFIRMED',reason:'AFTER_PAGE_UNCHANGED'};
    const targets=navigation.snapshot.lists.filter(list=>list.title===TEST_LIST);
    if(targets.length!==1)return {ok:false,code:'TEST_RECONNECT_UNCONFIRMED',reason:'AFTER_TARGET_NOT_UNIQUE'};
    const after=await controller.execute({type:'readList',pageId:navigation.snapshot.pageId,listId:targets[0].id},'cn');
    if(!after.ok)return {ok:false,code:'TEST_RECONNECT_UNCONFIRMED',reason:'AFTER_SCOPED_READ_FAILED',kind:known(after.code)};
    const beforeSync=result.snapshot.items.filter(item=>item.title===TEST_SYNC_ITEM);
    return {...after,code:'CLIENT_RECONNECTED',reconnectBeforeSyncFlagged:beforeSync.length===1 && typeof beforeSync[0].flagged==='boolean'?beforeSync[0].flagged:undefined,via:'Windows 本地重新连接按钮 IPC'};
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
  if (dateTest?.operation==='create' || ['create-test-item','create-sync-test-item','create-delete-test-item'].includes(command)) {
    if(dateTest && (result.snapshot.activeListId!==lists[0].id || result.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX))))return {ok:false,code:'TEST_SCOPE_REQUIRED'};
    const title=dateTest?dateTest.title:command==='create-delete-test-item'?TEST_DELETE_ITEM:command==='create-sync-test-item'?TEST_SYNC_ITEM:TEST_CREATED_ITEM;
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
  if(result.subtaskState && result.snapshot)return {...summarize({...result,subtaskState:undefined}),subtaskState:result.subtaskState,subtaskOrder:result.subtaskOrder};
  if(result.appearanceStyle && result.snapshot)return {...summarize({...result,appearanceStyle:undefined}),appearanceStyle:result.appearanceStyle};
  const snapshot = result.snapshot;
  const testList = snapshot?.activeListTitle.startsWith(TEST_PREFIX);
  const items = testList ? snapshot.items.filter(item => [TEST_ITEM, TEST_EDITED_ITEM].includes(item.title)) : [];
  const created = testList ? snapshot.items.filter(item => item.title === TEST_CREATED_ITEM) : [];
  const sync = testList ? snapshot.items.filter(item => item.title === TEST_SYNC_ITEM) : [];
  const deletion = testList ? snapshot.items.filter(item => item.title === TEST_DELETE_ITEM) : [];
  const managed=snapshot?.lists.filter(list=>[TEST_MANAGEMENT_LIST,TEST_MANAGEMENT_RENAMED].includes(list.title)) || [];
  const reconnectReason=result.code==='TEST_RECONNECT_UNCONFIRMED' && ['UI_NOT_READY','UI_ERROR','VIEW_NOT_RESTORED','OBSERVATION_TIMEOUT','UI_EXECUTION_FAILED','AFTER_NAVIGATION_READ_FAILED','AFTER_PAGE_UNCHANGED','AFTER_TARGET_NOT_UNIQUE','AFTER_SCOPED_READ_FAILED'].includes(result.reason)?result.reason:undefined;
  const reconnectKind=reconnectReason && ['OFFICIAL_PAGE_BUSY','RECONNECT_FAILED','PAGE_NOT_READY','LIST_LOADING','BUSY','STALE_VIEW','RECONNECT_TIMEOUT','NAVIGATION_FAILED','NAVIGATION_TIMEOUT','BRIDGE_TIMEOUT','OTHER'].includes(result.kind)?result.kind:undefined;
  return { ok: result.ok, code: result.code, reason:reconnectReason,kind:reconnectKind,stage:reconnectReason && ['home','reminders','opening','waiting-navigation','selecting-list','waiting-selected'].includes(result.stage)?result.stage:undefined,lists: snapshot?.lists.length, loadedItems: snapshot?.items.length,
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
    reconnectBeforeSyncFlagged:typeof result.reconnectBeforeSyncFlagged==='boolean'?result.reconnectBeforeSyncFlagged:undefined,
    testSyncPriority:sync.length===1?['none','low','medium','high'].includes(sync[0].priority)?sync[0].priority:null:undefined,
    dateTestCount:testList?snapshot.items.filter(item=>item.title===TEST_DATE_ROUNDTRIP_ITEM).length:undefined,
    dateTransitionTestCount:testList?snapshot.items.filter(item=>item.title===TEST_DATE_TRANSITION_ITEM).length:undefined,
    dateTestState:['empty','all-day','timed','other'].includes(result.dateTestState)?result.dateTestState:undefined,
    dateTestSource:['loaded-fields','official-details'].includes(result.dateTestSource)?result.dateTestSource:undefined,
    testScheduleSource:['loaded-fields','official-details'].includes(result.scheduleSource)?result.scheduleSource:undefined,
    deleteReady:result.deleteReady===true?true:undefined,
    testDeleteCount:testList?deletion.length:undefined,
    testSubtaskParentCount:testList?snapshot.items.filter(item=>item.title===TEST_SUBTASK_PARENT).length:undefined,
    testSubtaskChildCount:testList?snapshot.items.filter(item=>item.title===TEST_SUBTASK_CHILD).length:undefined,
    testDeletePending:deletion.length===1?!deletion[0].completed:undefined,
    testAppearanceListCount:snapshot?snapshot.lists.filter(list=>list.title===TEST_APPEARANCE_LIST).length:undefined,
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
    if (!DATE_TEST_COMMANDS.has(command) && !['create-date-roundtrip-test-item','read-date-roundtrip-test-item','set-date-roundtrip-test-time','clear-date-roundtrip-test-time','delete-date-roundtrip-test-item','create-subtask-test-parent','create-subtask-test-child','read-subtask-test-state','cancel-subtask-test-indent','indent-subtask-test-item','outdent-subtask-test-item','delete-subtask-test-child','delete-subtask-test-parent','select-appearance-test-list','create-appearance-test-list','read-appearance-test-style','cancel-appearance-test-edit','set-appearance-test-style','restore-appearance-test-style','delete-appearance-test-list','read-test-list-appearance','read-test-lists','select-test-list-in-client','cancel-management-list-delete','delete-management-test-list','inspect-management-list-delete','select-management-test-list','cancel-management-list-create','create-management-test-list','rename-management-test-list','restore-management-test-list','inspect-new-test-list','create-delete-test-item','cancel-delete-test-item','delete-test-item','inspect-sync-delete','open-sync-priority','inspect-sync-priority','cancel-sync-priority','reconnect-test-client','create-sync-test-item','flag-sync-test-item','unflag-sync-test-item','show-test-site','hide-test-site','reopen-test-site','flag-created-test-item', 'unflag-created-test-item', 'environment', 'diagnostics', 'verify-test-sorting', 'inspect-test-editor', 'open-test-details', 'inspect-test-details', 'inspect-test-date-binding', 'preview-test-date','cancel-test-details', 'read-test-schedule', 'set-test-date', 'set-test-time', 'clear-test-schedule', 'read', 'open-sign-in', 'select-test-list', 'show-completed', 'complete-test-item', 'uncomplete-test-item', 'edit-test-title', 'restore-test-title', 'edit-test-note', 'clear-test-note', 'create-test-item', 'reload', 'quit'].includes(command)) return;
    if (command === 'quit') { quit(); return; }
    if (busy) {
      if (requestId) fs.writeFileSync(resultFile, JSON.stringify({ requestId, result: { ok: false, code: 'BUSY' } }));
      return;
    }
    busy = true;
    try {
      let result;
      if (command === 'environment') {
        result={ok:true,packaged:environment?.packaged===true,profileKind:['system-default','project-local'].includes(environment?.profileKind)?environment.profileKind:'unknown',adapterVersion:controller.adapterVersion?.(),verificationVersion:'date-transition-1'};
      } else if (command === 'open-sign-in') {
        result = await controller.openSignIn();
      } else if (command === 'reload') {
        result = controller.reloadSite('cn');
      } else if (command === 'diagnostics') {
        result = await controller.diagnostics();
      } else if (command === 'inspect-test-editor') {
        result = await controller.inspectTestEditor();
      } else if(command==='read-test-list-appearance') {
        const current=await controller.execute({type:'read'},'cn');
        const list=current.snapshot?.lists.find(list=>list.id===current.snapshot.activeListId);
        if(!current.ok || list?.title!==TEST_LIST || current.snapshot.items.some(item=>!item.title.startsWith(TEST_PREFIX)))result={ok:false,code:'TEST_SCOPE_REQUIRED'};
        else {const value=await controller.execute({type:'getListAppearance',pageId:current.snapshot.pageId,listId:list.id,expectedListFingerprint:list.fingerprint},'cn');result={ok:value.ok,code:value.code,colors:value.appearance?.colors.length,icons:value.appearance?.icons.length,selectedColorKnown:!!value.appearance?.color,selectedIconKnown:!!value.appearance?.iconKey,dispatched:value.dispatched,shape:value.appearanceShape};}
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
