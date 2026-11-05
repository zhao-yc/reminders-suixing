const TEST_LIST='随行验证（2026-11-04）';
const TITLES=['随行验证 · 最小读写验证','随行验证 · Windows 新增验证','随行验证 · Windows 同步验证'];

/** 只观察本地界面元数据；不查询事项文字、输入值或官方页面。 */
function clientReadState(expected) {
  const list=document.querySelector('.list-content'),toggle=document.querySelector('.auto-read-toggle');
  return {ready:!!list && list.dataset.pageId===expected.pageId && list.dataset.listId===expected.listId && list.dataset.live==='true' &&
    !document.querySelector('.inline-editor,.network-notice') && toggle?.getAttribute('aria-pressed')==='true',
    updated:!!list && !!list.dataset.capturedAt && list.dataset.capturedAt!==expected.capturedAt};
}

/** 独立真实页面前置证据：限定原三项，观察正式自动读取与界面回执，不写入云端。 */
async function verifyTestAutoRead(controller,ui,{sendSnapshot,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=60}={}) {
  if(!ui || ui.isDestroyed?.() || !ui.isVisible() || ui.isMinimized())return {ok:false,code:'TEST_CLIENT_NOT_VISIBLE'};
  if(typeof controller.lastAutomaticReadOutcome!=='function')return {ok:false,code:'TEST_VERSION_REQUIRED'};
  if(controller.lastWriteOutcome())return {ok:false,code:'TEST_READ_ONLY_SESSION_REQUIRED'};
  const writeBefore=controller.lastWriteOutcome()?.sequence || 0;
  const navigation=await controller.execute({type:'readLists'},'cn');if(!navigation.ok)return {ok:false,code:navigation.code};
  const targets=navigation.snapshot.lists.filter(list=>list.title===TEST_LIST);if(targets.length!==1)return {ok:false,code:'TEST_LIST_NOT_UNIQUE'};
  const command={type:'readList',pageId:navigation.snapshot.pageId,listId:targets[0].id};
  const before=await controller.execute(command,'cn');if(!before.ok)return {ok:false,code:before.code};
  const valid=snapshot=>snapshot?.pageId===command.pageId && snapshot.activeListId===command.listId && snapshot.activeListTitle===TEST_LIST && !snapshot.partial &&
    snapshot.items.length===3 && TITLES.every(title=>snapshot.items.filter(item=>item.title===title).length===1) && snapshot.items.every(item=>item.completed===false && typeof item.fingerprint==='string' && !!item.fingerprint);
  if(!valid(before.snapshot))return {ok:false,code:'TEST_SCOPE_REQUIRED'};
  const expected={pageId:command.pageId,listId:command.listId,capturedAt:before.snapshot.capturedAt};
  const inspect=()=>ui.webContents.executeJavaScript('('+clientReadState.toString()+')('+JSON.stringify(expected)+')');
  sendSnapshot(before);await wait(150);if(!(await inspect()).ready)return {ok:false,code:'TEST_AUTO_READ_NOT_READY'};
  const automaticBefore=controller.lastAutomaticReadOutcome()?.sequence || 0;
  await wait(3200);await ui.webContents.executeJavaScript('window.dispatchEvent(new Event("focus"))');
  let observed=false;
  for(let attempt=0;attempt<attempts;attempt++) {
    const outcome=controller.lastAutomaticReadOutcome(),client=await inspect();
    if(!client.ready || (controller.lastWriteOutcome()?.sequence || 0)!==writeBefore)return {ok:false,code:'TEST_AUTO_READ_INTERRUPTED'};
    if(outcome?.sequence>automaticBefore && outcome.code!=='IN_FLIGHT') {
      if(!outcome.ok || !outcome.samePage || !outcome.sameList)return {ok:false,code:outcome.code};
      if(client.updated){observed=true;break;}
    }
    await wait(120);
  }
  if(!observed)return {ok:false,code:'TEST_AUTO_READ_NOT_OBSERVED'};
  const after=await controller.execute(command,'cn');if(!after.ok)return {ok:false,code:after.code};
  const unchanged=valid(after.snapshot) && JSON.stringify(before.snapshot.items.map(item=>item.fingerprint))===JSON.stringify(after.snapshot.items.map(item=>item.fingerprint));
  const noWrites=(controller.lastWriteOutcome()?.sequence || 0)===writeBefore;
  if(!unchanged || !noWrites)return {ok:false,code:'TEST_AUTO_READ_CHANGED'};
  return {ok:true,code:'TEST_AUTO_READ_OBSERVED',loadedTestItems:3,automaticRead:true,clientUpdated:true,itemsUnchanged:true,noWrites:true,
    evidence:'当前固定清单的官方网页自动读取；不证明跨设备新变更到达或完整云端同步'};
}
module.exports={verifyTestAutoRead};
