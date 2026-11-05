/** 仅观察本地专用清单的连接提示；恢复步骤只点一次正式刷新，不触碰事项。 */
async function offlineTestUI(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
  let clicked=false;
  for(let attempt=0;attempt<50;attempt++) {
    const list=document.querySelector('.list-content'),notice=document.querySelector('.network-notice');
    if(!list || list.dataset.listId!==expected.listId || document.querySelector('.list-title')?.textContent.trim()!==expected.title || document.querySelector('.inline-editor'))return false;
    if(expected.stage==='ready')return list.dataset.pageId===expected.pageId && list.dataset.live==='true';
    if(expected.stage==='offline' && ['offline','unavailable'].includes(notice?.dataset.state) && list.dataset.live==='false')return true;
    if(expected.stage==='restored' && notice?.dataset.state==='read-required' && list.dataset.live==='false')return true;
    if(expected.stage==='refresh') {
      if(!clicked) {
        const button=document.querySelector('.refresh-button');
        if(list.dataset.pageId!==expected.pageId || !button || button.hasAttribute('disabled'))return false;
        clicked=true;button.click();
      } else if(list.dataset.pageId!==expected.pageId && list.dataset.live==='true' && !notice)return true;
    }
    await pause();
  }
  return false;
}

/** 只在固定测试清单模拟连接故障；无论结果如何均撤销会话模拟或公开检查钩子。 */
async function verifyTestOffline(controller,ui,before,mode='session-emulation') {
  if(!['session-emulation','public-resource-fault'].includes(mode))return {ok:false,code:'INVALID_DIAGNOSTIC_ACTION'};
  const title='随行验证（2026-11-04）';
  if(before?.activeListTitle!==title || !before.items.length || before.items.length>80 || before.items.some(item=>typeof item.title!=='string' || !item.title.startsWith('随行验证')) || controller.lastWriteOutcome()?.replyPending)return {ok:false,code:'TEST_OFFLINE_SCOPE_REQUIRED'};
  const expected={pageId:before.pageId,listId:before.activeListId,title};
  const observe=async stage=>{try{return await ui.webContents.executeJavaScript('('+offlineTestUI.toString()+')('+JSON.stringify({...expected,stage})+')',true)===true;}catch{return false;}};
  if(!await observe('ready') || (await controller.connectionState('cn',true)).state!=='available')return {ok:false,code:'TEST_OFFLINE_NOT_READY'};
  const session=controller.window()?.webContents.session;if(!session)return {ok:false,code:'TEST_OFFLINE_NOT_READY'};
  const sequence=controller.lastWriteOutcome()?.sequence || 0;
  let restore,offlineObserved=false,uiPreserved=false,readBlocked=false,reconnectBlocked=false;
  try {
    if(mode==='public-resource-fault') {
      restore=()=>session.webRequest.onBeforeRequest(null);
      session.webRequest.onBeforeRequest({urls:['https://www.icloud.com.cn/favicon.ico']},(details,callback)=>callback({cancel:details.method==='HEAD'}));
    } else {restore=()=>session.disableNetworkEmulation();session.enableNetworkEmulation({offline:true});}
    offlineObserved=['offline','unavailable'].includes((await controller.connectionState('cn',true)).state);
    if(!offlineObserved)return {ok:false,code:'TEST_OFFLINE_NOT_OBSERVED'};
    uiPreserved=await observe('offline');
    const read=await controller.execute({type:'readList',pageId:before.pageId,listId:before.activeListId},'cn');
    readBlocked=['OFFLINE','CONNECTION_UNAVAILABLE'].includes(read.code) && read.dispatched===false;
    if(!uiPreserved || !readBlocked)return {ok:false,code:'TEST_OFFLINE_PROTECTION_UNCONFIRMED'};
    reconnectBlocked=['OFFLINE','CONNECTION_UNAVAILABLE'].includes((await controller.reconnectSite('cn')).code);
  } finally {
    if(restore){restore();await controller.connectionState('cn',true);}
  }
  const recoveryRequired=await observe('restored');
  if(!reconnectBlocked || !recoveryRequired || !await observe('refresh'))return {ok:false,code:'TEST_OFFLINE_RECOVERY_UNCONFIRMED'};
  const navigation=await controller.execute({type:'readLists'},'cn');if(!navigation.ok)return navigation;
  const targets=navigation.snapshot.lists.filter(list=>list.title===title);
  if(targets.length!==1)return {ok:false,code:'TEST_LIST_NOT_UNIQUE'};
  const after=await controller.execute({type:'readList',pageId:navigation.snapshot.pageId,listId:targets[0].id},'cn');
  const unchanged=after.ok && after.snapshot.items.length===before.items.length && before.items.every(item=>after.snapshot.items.some(current=>current.fingerprint===item.fingerprint));
  const noWrites=(controller.lastWriteOutcome()?.sequence || 0)===sequence;
  if(!unchanged || !noWrites)return {ok:false,code:'TEST_OFFLINE_CONTENT_UNCONFIRMED'};
  return {...after,code:mode==='public-resource-fault'?'TEST_PUBLIC_CONNECTION_RECOVERED':'TEST_OFFLINE_RECOVERED',offlineTest:{mode,offlineObserved,uiPreserved,readBlocked,reconnectBlocked,recoveryRequired,refreshed:true,testItemsUnchanged:unchanged,noWrites}};
}

module.exports={offlineTestUI,verifyTestOffline};
