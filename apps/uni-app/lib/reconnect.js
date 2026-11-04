/** 重开后先等导航元数据；只有明确恢复指定清单，才读取它的事项。 */
export async function reconnectLoadedList(bridge, region, previous={}, options={}) {
  const wait=options.wait || (()=>new Promise(resolve=>setTimeout(resolve,200)));
  const attempts=options.attempts || 24;
  const pending=new Set(['PAGE_NOT_READY','LIST_LOADING','BUSY']);
  const unavailable=()=>({ok:false,code:'PAGE_NOT_READY',message:'官方页面尚未就绪，请完成登录或稍后读取。'});
  async function readReady(command,accept) {
    const deadline=Date.now()+6000;
    for(let attempt=0;attempt<attempts;attempt++) {
      const result=await bridge.execute(command,region);
      if(result.ok && result.snapshot?.pageId && accept(result.snapshot)) return result;
      if(!result.ok && !pending.has(result.code)) return result;
      if(Date.now()>=deadline) break;
      if(attempt+1<attempts) await wait();
    }
    return unavailable();
  }
  if(typeof bridge.reconnectSite!=='function') return {ok:false,code:'CLIENT_REQUIRED',message:'当前客户端尚不支持重新连接。'};
  let stage='opening';
  try {
    const reopened=await bridge.reconnectSite(region);
    if(!reopened.ok) return reopened;
    stage='waiting-navigation';
    let result=await readReady({type:'readLists'},snapshot=>snapshot.pageId!==previous.pageId);
    if(!result.ok) return result;
    if(!previous.title) return {...result,code:'RECONNECTED_SELECT_LIST',needsListSelection:true,message:result.snapshot.emptyAccount?'已重新连接，可以新建第一份清单。':'已重新连接，请选择清单。'};
    const lists=result.snapshot.lists.filter(list=>list.title===previous.title);
    if(lists.length!==1) return {...result,code:'RECONNECTED_SELECT_LIST',needsListSelection:true,message:'重新连接完成，请重新选择清单后继续编辑。'};
    const target=lists[0],expectedPage=result.snapshot.pageId;
    stage='selecting-list';
    const selected=await bridge.execute({type:'selectList',pageId:expectedPage,listId:target.id},region);
    if(!selected.ok && !['PAGE_NOT_READY','LIST_LOADING'].includes(selected.code)) return selected;
    stage='waiting-selected';
    result=selected.ok && selected.snapshot?selected:await readReady({type:'readList',pageId:expectedPage,listId:target.id},snapshot=>snapshot.pageId===expectedPage && snapshot.activeListId===target.id);
    if(!result.ok) return result;
    if(result.snapshot.pageId!==expectedPage || result.snapshot.activeListId!==target.id || result.snapshot.activeListTitle!==previous.title) return {ok:false,code:'STALE_VIEW',message:'清单位置已变化，请重新读取并选择清单。'};
    return {...result,code:'RECONNECTED',needsListSelection:false,message:'已重新连接并读取当前清单，范围为网页已加载内容。'};
  } catch(error) {return {ok:false,code:'RECONNECT_FAILED',reconnectStage:stage,errorKind:['Error','TypeError','ReferenceError','AbortError'].includes(error?.name)?error.name:'OTHER',message:'重新连接暂不可用，请在官方页面核对。'};}
}
