/** 只点击本地今天、计划与未完成视图；固定测试清单须没有可读的已设日期。 */
async function inspectTestViews(expected) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
  const root=document.querySelector('.list-content');
  const button=view=>document.querySelector('.view-tab:not([data-scope=summary] .view-tab)[data-status="'+view+'"]');
  if(root?.dataset.listId!==expected.listId || root.dataset.pageId!==expected.pageId || (root.dataset.listTitle ?? document.querySelector('.list-title')?.textContent.trim())!=='随行验证（2026-11-04）' || document.querySelector('.inline-editor') || document.querySelector('.flag-filter[aria-pressed="true"]') || document.querySelector('.toolbar-search input')?.value)return false;
  if(button('pending')?.getAttribute('aria-pressed')!=='true')return false;
  let success=true;
  try {
    for(const view of ['today','scheduled']) {
      const tab=button(view);if(!tab || tab.hasAttribute('disabled'))return false;
      tab.click();let observed=false;
      for(let attempt=0;attempt<30;attempt++) {
        await pause();const summary=document.querySelector('.date-view-description');
        if(tab.getAttribute('aria-pressed')==='true' && summary?.dataset.view===view && summary.dataset.matches==='0' && summary.dataset.unknown===String(expected.unknown) && document.querySelectorAll('.reminder-row').length===0){observed=true;break;}
      }
      if(!observed){success=false;break;}
    }
  } finally {
    if(button('pending') && !button('pending').hasAttribute('disabled'))button('pending').click();
  }
  for(let attempt=0;attempt<30;attempt++) {
    await pause();
    const ids=[...document.querySelectorAll('.reminder-row')].map(row=>row.dataset.recordId);
    if(button('pending')?.getAttribute('aria-pressed')==='true' && ids.length===expected.ids.length && expected.ids.every(id=>ids.includes(id)))return success;
  }
  return false;
}

async function verifyTestViews(controller,ui,before) {
  if(before?.activeListTitle!=='随行验证（2026-11-04）' || before.items.length!==3 || before.items.some(item=>!item.title.startsWith('随行验证') || item.completed || item.schedule?.date) || controller.lastWriteOutcome()?.replyPending)return {ok:false,code:'TEST_VIEWS_SCOPE_REQUIRED'};
  const sequence=controller.lastWriteOutcome()?.sequence || 0;
  const expected={pageId:before.pageId,listId:before.activeListId,ids:before.items.map(item=>item.id),unknown:before.items.filter(item=>!item.schedule).length};
  const observed=await ui.webContents.executeJavaScript('('+inspectTestViews.toString()+')('+JSON.stringify(expected)+')',true);
  const after=await controller.execute({type:'readList',pageId:before.pageId,listId:before.activeListId},'cn');
  const unchanged=after.ok && after.snapshot.items.length===before.items.length && before.items.every(item=>after.snapshot.items.some(current=>current.fingerprint===item.fingerprint));
  const noWrites=(controller.lastWriteOutcome()?.sequence || 0)===sequence;
  return observed && noWrites && unchanged?{...after,code:'TEST_VIEWS_OBSERVED',viewTest:{today:true,scheduled:true,unknownVisible:true,pendingRestored:true,testItemsUnchanged:unchanged,noWrites}}:{ok:false,code:'TEST_VIEWS_UNCONFIRMED'};
}

module.exports={inspectTestViews,verifyTestViews};
