const {editTestSchedule}=require('./verification-ui.cjs');
const TITLES=['随行验证 · 最小读写验证','随行验证 · Windows 新增验证','随行验证 · Windows 同步验证'];
const LIST='随行验证（2026-11-04）';

/** 独立端已确认旧清除未保存；新修复只接受重新读取的固定旧时间，不重放历史请求。 */
async function originalDateRepair(controller,command,{sendSnapshot,ui}) {
  const repairing=command==='repair-original-test-date';
  if(!repairing && command!=='read-original-test-repair-state')return {ok:false,code:'INVALID_DIAGNOSTIC_ACTION'};
  const navigation=await controller.execute({type:'readLists'},'cn');if(!navigation.ok)return navigation;
  const lists=navigation.snapshot.lists.filter(list=>list.title===LIST);if(lists.length!==1)return {ok:false,code:'TEST_LIST_NOT_UNIQUE'};
  const binding={pageId:navigation.snapshot.pageId,listId:lists[0].id};
  const before=await controller.execute({type:'readList',...binding},'cn');if(!before.ok)return before;
  if(before.snapshot.items.length!==3 || TITLES.some(title=>before.snapshot.items.filter(item=>item.title===title).length!==1))return {ok:false,code:'ORIGINAL_REPAIR_SCOPE_REQUIRED'};
  const item=before.snapshot.items.find(item=>item.title===TITLES[0]);
  if(item.completed || item.notes!=='' || typeof item.flagged!=='boolean')return {ok:false,code:'ORIGINAL_REPAIR_SCOPE_REQUIRED'};
  const request={type:'getSchedule',...binding,id:item.id,fingerprint:item.fingerprint,expectedCompleted:false};
  const current=await controller.execute(request,'cn');if(!current.ok)return current;
  const empty=value=>value?.date===null && value.time===null && value.timeZone===null;
  if(empty(current.schedule))return {...current,code:repairing?'UNCHANGED':'ORIGINAL_DATE_EMPTY',originalRepairState:'empty',dispatched:false};
  if(current.schedule?.date!=='2030-01-15' || current.schedule.time!=='14:35' || current.schedule.timeZone!==current.editorTimeZone || current.scheduleSource!=='official-details')return {ok:false,code:'ORIGINAL_REPAIR_STATE_CHANGED'};
  if(!repairing)return {...current,code:'ORIGINAL_DATE_PRESENT',originalRepairState:'present',dispatched:false};
  const sequence=controller.lastWriteOutcome()?.sequence || 0;
  if(controller.lastWriteOutcome()?.replyPending)return {ok:false,code:'BUSY'};
  sendSnapshot(current);await new Promise(resolve=>setTimeout(resolve,120));
  let clicked=false;
  try{clicked=await ui.webContents.executeJavaScript('('+editTestSchedule.toString()+')('+JSON.stringify({...binding,id:item.id,title:item.title,completed:false,value:{date:null,time:null,timeZone:null}})+')',true)===true;}catch{}
  if(!clicked)return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
  let outcome;
  for(let attempt=0;attempt<90;attempt++) {await new Promise(resolve=>setTimeout(resolve,150));outcome=controller.lastWriteOutcome();if(outcome?.sequence>sequence && !outcome.replyPending)break;}
  if(!outcome || outcome.sequence<=sequence || outcome.replyPending || outcome.type!=='setSchedule')return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
  if(!outcome.ok)return {ok:false,code:outcome.code,dispatched:outcome.dispatched,cloudConfirmed:false};
  const after=await controller.execute({type:'readList',...binding},'cn');if(!after.ok)return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
  const target=after.snapshot.items.find(candidate=>candidate.id===item.id);
  const fields=['id','title','notes','completed','flagged','priority','level','parentId'];
  if(after.snapshot.items.length!==3 || !target || fields.some(key=>target[key]!==item[key]) || !before.snapshot.items.filter(candidate=>candidate.id!==item.id).every(candidate=>after.snapshot.items.some(actual=>actual.fingerprint===candidate.fingerprint)))return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
  const observed=await controller.execute({...request,fingerprint:target.fingerprint},'cn');
  if(!observed.ok || !empty(observed.schedule))return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
  return {...observed,code:'WEB_STATE_OBSERVED',originalRepairState:'empty',dispatched:true,cloudConfirmed:false};
}
module.exports={originalDateRepair};
