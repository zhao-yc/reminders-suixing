const {createTestItem,editTestSchedule,editTestSubtask,deleteTestItem}=require('./verification-ui.cjs');

const LIST='随行验证（2026-11-04）';
const ALPHA='随行验证 · Windows 日期视图甲项',BETA='随行验证 · Windows 日期视图乙项';
const DAY='2024-02-29';
const BASE=['随行验证 · 最小读写验证','随行验证 · Windows 新增验证','随行验证 · Windows 同步验证'];
const TITLES=new Set([...BASE,ALPHA,BETA]);
const COMMANDS=new Set(['create-view-test-alpha','create-view-test-beta','read-view-test-state','set-view-test-day','inspect-view-test-indent','indent-view-test-item','verify-view-test-results','outdent-view-test-item','clear-view-test-day','delete-view-test-beta','delete-view-test-alpha']);
const WRITES=new Set([...COMMANDS].filter(command=>!['read-view-test-state','verify-view-test-results','inspect-view-test-indent'].includes(command)));
const empty=schedule=>schedule?.date===null && schedule.time===null && schedule.timeZone===null;
const dated=schedule=>schedule?.date===DAY && schedule.time===null && schedule.timeZone===null;
const clean=item=>item && item.completed===false && item.notes==='' && item.flagged===false && item.priority==='none' && (empty(item.schedule) || dated(item.schedule));

/** 名称只限定新专项，父子角色始终按官方当前两条记录的顺序和关系确认。 */
function classifyViewScenario(snapshot) {
  if(snapshot?.activeListTitle!==LIST || snapshot.items.length<3 || snapshot.items.length>5 || snapshot.items.some(item=>!TITLES.has(item.title) || item.completed) || BASE.some(title=>!snapshot.items.some(item=>item.title===title)) || [...TITLES].some(title=>snapshot.items.filter(item=>item.title===title).length>1))return {state:'scope-invalid'};
  const alpha=snapshot.items.find(item=>item.title===ALPHA),beta=snapshot.items.find(item=>item.title===BETA);
  const ordered=snapshot.items.filter(item=>item.title===ALPHA || item.title===BETA),parent=ordered[0],child=ordered[1];
  let state='other';
  if(!alpha && !beta)state='none';
  else if(alpha && !beta && clean(alpha) && empty(alpha.schedule) && alpha.level===1 && alpha.parentId===null)state='alpha-only';
  else if(alpha && beta && clean(parent) && clean(child) && empty(parent.schedule) && parent.level===1 && parent.parentId===null) {
    if(child.level===1 && child.parentId===null)state=empty(child.schedule)?'flat-empty':'flat-dated';
    else if(child.level===2 && child.parentId===parent.id && dated(child.schedule))state='nested-dated';
  }
  return {state,alpha,beta,parent,child};
}

/** 仅切换本地视图，观察指定父子记录和未知日期说明，最后恢复未完成。 */
async function inspectDatedTestViews(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
  const tab=view=>(view==='today' && document.querySelector('.local-today-button')) || document.querySelector('.view-tab[data-status="'+view+'"]');
  const root=document.querySelector('.list-content');
  if(root?.dataset.pageId!==expected.pageId || root.dataset.listId!==expected.listId || document.querySelector('.inline-editor') || document.querySelector('.toolbar-search input')?.value || document.querySelector('.flag-filter[aria-pressed="true"]') || tab('pending')?.getAttribute('aria-pressed')!=='true')return false;
  let confirmed=true;
  try {
    for(const view of ['today','scheduled']) {
      if(!tab(view) || tab(view).hasAttribute('disabled'))return false;
      tab(view).click();let observed=false;
      for(let attempt=0;attempt<40;attempt++) {
        await pause();const summary=document.querySelector('.date-view-description'),rows=[...document.querySelectorAll('.reminder-row')];
        const parent=rows.find(row=>row.dataset.recordId===expected.parent),child=rows.find(row=>row.dataset.recordId===expected.child);
        if(tab(view).getAttribute('aria-pressed')==='true' && summary?.dataset.view===view && summary.dataset.matches==='1' && summary.dataset.unknown===String(expected.unknown) && rows.length===2 && parent?.dataset.viewContext==='true' && parent.querySelector('.completion-button')?.hasAttribute('disabled') && !parent.querySelector('.row-actions') && child?.dataset.viewContext==='false' && child.classList.contains('is-subtask')){observed=true;break;}
      }
      if(!observed){confirmed=false;break;}
    }
  } finally {if(tab('pending') && !tab('pending').hasAttribute('disabled'))tab('pending').click();}
  for(let attempt=0;attempt<40;attempt++) {
    await pause();const rows=[...document.querySelectorAll('.reminder-row')];
    if(tab('pending')?.getAttribute('aria-pressed')==='true' && rows.length===expected.ids.length && expected.ids.every(id=>rows.some(row=>row.dataset.recordId===id)))return confirmed;
  }
  return false;
}

async function runViewScenario(controller,command,{ui,sendSnapshot}) {
  if(!COMMANDS.has(command))return {ok:false,code:'INVALID_DIAGNOSTIC_ACTION'};
  const navigation=await controller.execute({type:'readLists'},'cn');if(!navigation.ok)return navigation;
  const lists=navigation.snapshot.lists.filter(list=>list.title===LIST);if(lists.length!==1)return {ok:false,code:'TEST_LIST_NOT_UNIQUE'};
  const binding={pageId:navigation.snapshot.pageId,listId:lists[0].id};
  const before=await controller.execute({type:'readList',...binding},'cn');if(!before.ok)return before;
  const scene=classifyViewScenario(before.snapshot);
  const finish=(reply,code=reply.code)=>({...reply,code,viewScenario:{state:classifyViewScenario(reply.snapshot).state,alphaCount:reply.snapshot.items.filter(item=>item.title===ALPHA).length,betaCount:reply.snapshot.items.filter(item=>item.title===BETA).length}});
  if(['scope-invalid','other'].includes(scene.state))return {ok:false,code:'TEST_VIEW_SCENARIO_SCOPE_REQUIRED'};
  if(command==='read-view-test-state')return finish(before,'VIEW_SCENARIO_READ');
  if(command==='inspect-view-test-indent') {
    if(scene.state!=='flat-dated')return {ok:false,code:'TEST_VIEW_SCENARIO_STATE_REQUIRED'};
    const target=scene.child;
    const info=await controller.execute({type:'getSubtaskInfo',...binding,id:target.id,fingerprint:target.fingerprint,expectedCompleted:false,direction:'indent'},'cn');
    return info.ok?finish(info,'VIEW_INDENT_READY'):info;
  }
  if(controller.lastWriteOutcome()?.replyPending)return {ok:false,code:'BUSY'};
  const sequence=controller.lastWriteOutcome()?.sequence || 0;
  if(command==='verify-view-test-results') {
    if(scene.state!=='nested-dated' || new Date().getFullYear()<2025)return {ok:false,code:'TEST_VIEW_SCENARIO_STATE_REQUIRED'};
    const expected={...binding,parent:scene.parent.id,child:scene.child.id,ids:before.snapshot.items.map(item=>item.id),unknown:before.snapshot.items.filter(item=>item.completed===false && !item.schedule).length};
    sendSnapshot(before);await new Promise(resolve=>setTimeout(resolve,120));
    let observed=false;try{observed=await ui.webContents.executeJavaScript('('+inspectDatedTestViews.toString()+')('+JSON.stringify(expected)+')',true)===true;}catch{}
    const after=await controller.execute({type:'readList',...binding},'cn');
    const same=after.ok && after.snapshot.items.length===before.snapshot.items.length && before.snapshot.items.every(item=>after.snapshot.items.some(current=>current.fingerprint===item.fingerprint));
    if(!observed || !same || (controller.lastWriteOutcome()?.sequence || 0)!==sequence)return {ok:false,code:'TEST_VIEW_RESULTS_UNCONFIRMED'};
    return {...finish(after,'VIEW_DATE_RESULTS_OBSERVED'),viewProof:{today:true,scheduled:true,readonlyParent:true,pendingRestored:true,testItemsUnchanged:true,noWrites:true}};
  }
  const creating=command.startsWith('create-'),deleting=command.startsWith('delete-'),hierarchy=command.startsWith('indent-') || command.startsWith('outdent-');
  const alphaTarget=command.endsWith('-alpha'),target=creating || deleting?alphaTarget?scene.alpha:scene.beta:scene.child;
  if(creating && target)return finish({...before,dispatched:false},'UNCHANGED');
  const required=creating?alphaTarget?'none':'alpha-only':deleting?alphaTarget?'alpha-only':'flat-empty':command==='set-view-test-day'?'flat-empty':command==='clear-view-test-day' || command==='indent-view-test-item'?'flat-dated':'nested-dated';
  if(scene.state!==required)return {ok:false,code:'TEST_VIEW_SCENARIO_STATE_REQUIRED'};
  const others=before.snapshot.items.filter(item=>creating?true:hierarchy?![scene.parent?.id,scene.child?.id].includes(item.id):item.id!==target.id).map(item=>item.fingerprint);
  let prepared=before,expected={...binding,title:alphaTarget?ALPHA:BETA};
  if(deleting)expected={...binding,id:target.id,title:target.title};
  else if(hierarchy) {
    prepared=await controller.execute({type:'getSubtaskInfo',...binding,id:target.id,fingerprint:target.fingerprint,expectedCompleted:false,direction:command.startsWith('outdent-')?'outdent':'indent'},'cn');
    if(!prepared.ok)return prepared;
    if(prepared.subtask.parentTitle!==scene.parent.title || prepared.subtask.affectedCount!==1)return {ok:false,code:'TEST_VIEW_SCENARIO_PLAN_REQUIRED'};
    expected={...binding,id:target.id,title:target.title};
  } else if(!creating) {
    prepared=await controller.execute({type:'getSchedule',...binding,id:target.id,fingerprint:target.fingerprint,expectedCompleted:false},'cn');if(!prepared.ok)return prepared;
    if(command==='set-view-test-day'?!empty(prepared.schedule):!dated(prepared.schedule))return {ok:false,code:'TEST_VIEW_SCENARIO_DATE_REQUIRED'};
    expected={...binding,id:target.id,title:target.title,completed:false,value:{date:command==='set-view-test-day'?DAY:null,time:null,timeZone:null}};
  }
  sendSnapshot(prepared);await new Promise(resolve=>setTimeout(resolve,120));
  let clicked=false;
  try{clicked=await ui.webContents.executeJavaScript('('+(creating?createTestItem:deleting?deleteTestItem:hierarchy?editTestSubtask:editTestSchedule).toString()+')('+JSON.stringify(expected)+')',true);}catch{return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};}
  if(!clicked)return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
  let outcome;
  for(let attempt=0;attempt<90;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,150));outcome=controller.lastWriteOutcome();
    if(outcome && outcome.sequence>sequence && !outcome.replyPending)break;
  }
  if(!outcome || outcome.sequence<=sequence || outcome.replyPending)return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
  if(!outcome.ok)return {ok:false,code:outcome.code,dispatched:outcome.dispatched,cloudConfirmed:false};
  const after=await controller.execute({type:'readList',...binding},'cn');if(!after.ok)return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
  const wanted=creating?alphaTarget?'alpha-only':'flat-empty':deleting?alphaTarget?'none':'alpha-only':command==='set-view-test-day' || command==='outdent-view-test-item'?'flat-dated':command==='clear-view-test-day'?'flat-empty':'nested-dated';
  if(classifyViewScenario(after.snapshot).state!==wanted || after.snapshot.items.length!==before.snapshot.items.length+(creating?1:deleting?-1:0) || !others.every(fingerprint=>after.snapshot.items.some(item=>item.fingerprint===fingerprint)))return {ok:false,code:'UNCERTAIN_WRITE',cloudConfirmed:false};
  return finish({...after,dispatched:true,cloudConfirmed:false},'WEB_STATE_OBSERVED');
}

module.exports={VIEW_SCENARIO_COMMANDS:COMMANDS,VIEW_SCENARIO_WRITES:WRITES,classifyViewScenario,inspectDatedTestViews,runViewScenario};
