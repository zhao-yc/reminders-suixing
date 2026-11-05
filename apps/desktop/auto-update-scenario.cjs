const LIST='随行验证（2026-11-04）';
const ITEM='随行验证 · Windows 自动更新验证';
const BASE=['随行验证 · 最小读写验证','随行验证 · Windows 新增验证','随行验证 · Windows 同步验证'];
const COMMANDS=new Set(['begin-test-auto-observation','poll-test-auto-observation','end-test-auto-observation']);

/** 只看已绑定测试界面；观察期间不主动读取、重连或改写官方页面。 */
function inspectClient(expected) {
  const root=document.querySelector('.list-content');
  if(root?.dataset.pageId!==expected.pageId || root.dataset.listId!==expected.listId || root.dataset.live!=='true' ||
    document.querySelector('.inline-editor') || document.querySelector('.toolbar-search input')?.value || document.querySelector('.flag-filter[aria-pressed=true]') ||
    document.querySelector('.view-tab[data-status=pending]')?.getAttribute('aria-pressed')!=='true')return {ready:false};
  const rows=[...root.querySelectorAll('.reminder-row[data-record-id]')];
  const extras=rows.filter(row=>!expected.ids.includes(row.dataset.recordId));
  return {ready:true,capturedAt:root.dataset.capturedAt,basePresent:expected.ids.every(id=>rows.some(row=>row.dataset.recordId===id)),
    targetPresent:extras.length===1 && extras[0].querySelector('.reminder-title')?.textContent.trim()===expected.title && !extras[0].classList.contains('completed'),
    unexpected:extras.length>1 || extras.length===1 && extras[0].querySelector('.reminder-title')?.textContent.trim()!==expected.title};
}

function createAutoUpdateScenario() {
  let observation=null;
  async function run(controller,ui,command,{sendSnapshot,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
    if(!COMMANDS.has(command))return {ok:false,code:'INVALID_DIAGNOSTIC_ACTION'};
    if(command==='end-test-auto-observation'){observation=null;return {ok:true,code:'TEST_AUTO_OBSERVATION_ENDED'};}
    if(command==='begin-test-auto-observation') {
      if(observation)return {ok:false,code:'TEST_AUTO_OBSERVATION_EXISTS'};
      if(controller.lastWriteOutcome() || !ui.isVisible() || ui.isMinimized())return {ok:false,code:'TEST_READ_ONLY_SESSION_REQUIRED'};
      const nav=await controller.execute({type:'readLists'},'cn');if(!nav.ok)return {ok:false,code:nav.code};
      const lists=nav.snapshot.lists.filter(list=>list.title===LIST);if(lists.length!==1)return {ok:false,code:'TEST_LIST_NOT_UNIQUE'};
      const binding={pageId:nav.snapshot.pageId,listId:lists[0].id};
      const before=await controller.execute({type:'readList',...binding},'cn');if(!before.ok)return {ok:false,code:before.code};
      if(before.snapshot.activeListTitle!==LIST || before.snapshot.partial || before.snapshot.items.length!==3 ||
        !BASE.every(title=>before.snapshot.items.filter(item=>item.title===title && !item.completed && typeof item.fingerprint==='string').length===1))return {ok:false,code:'TEST_SCOPE_REQUIRED'};
      const expected={...binding,ids:before.snapshot.items.map(item=>item.id),title:ITEM};
      sendSnapshot(before);await wait(150);
      const client=await ui.webContents.executeJavaScript('('+inspectClient.toString()+')('+JSON.stringify(expected)+')');
      if(!client.ready || !client.basePresent || client.targetPresent || client.unexpected)return {ok:false,code:'TEST_AUTO_READ_NOT_READY'};
      observation={binding,expected,fingerprints:before.snapshot.items.map(item=>item.fingerprint),sequence:controller.lastAutomaticReadOutcome()?.sequence || 0};
      return {ok:true,code:'TEST_AUTO_OBSERVATION_READY',loadedTestItems:3,noWrites:true};
    }
    if(!observation)return {ok:false,code:'TEST_AUTO_OBSERVATION_REQUIRED'};
    if(controller.lastWriteOutcome())return {ok:false,code:'TEST_AUTO_OBSERVATION_INTERRUPTED'};
    const client=await ui.webContents.executeJavaScript('('+inspectClient.toString()+')('+JSON.stringify(observation.expected)+')');
    if(!client.ready || !client.basePresent || client.unexpected)return {ok:false,code:'TEST_AUTO_OBSERVATION_INTERRUPTED'};
    const receipt=controller.lastAutomaticReadOutcome();
    if(!client.targetPresent || !receipt?.ok || receipt.sequence<=observation.sequence || !receipt.samePage || !receipt.sameList || client.capturedAt!==receipt.capturedAt)return {ok:true,code:'TEST_AUTO_OBSERVATION_WAITING',targetObserved:false,noWrites:true};
    // 只在自动读取已在界面显示新项后，才显式读回核对；不会用手动读取帮助观察达标。
    const after=await controller.execute({type:'readList',...observation.binding},'cn');if(!after.ok)return {ok:false,code:after.code};
    const target=after.snapshot.items.filter(item=>item.title===ITEM);
    if(after.snapshot.activeListTitle!==LIST || after.snapshot.items.length!==4 || target.length!==1 || target[0].completed ||
      !observation.fingerprints.every(value=>after.snapshot.items.some(item=>item.fingerprint===value)))return {ok:false,code:'TEST_AUTO_OBSERVATION_CHANGED'};
    observation=null;
    return {ok:true,code:'TEST_AUTO_EXTERNAL_CREATE_OBSERVED',targetObserved:true,automaticRead:true,clientUpdated:true,baseUnchanged:true,noWrites:true,cloudConfirmed:false};
  }
  return {run};
}
module.exports={AUTO_UPDATE_COMMANDS:COMMANDS,createAutoUpdateScenario};
