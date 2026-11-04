/** 重开官方容器后只读等待新页面；清单仅按唯一名称恢复，不使用旧页面句柄。 */
export async function reconnectLoadedList(bridge, region, previous={}, options={}) {
  const wait=options.wait || (()=>new Promise(resolve=>setTimeout(resolve,200)));
  const attempts=options.attempts || 24;
  const pending=new Set(['PAGE_NOT_READY','LIST_LOADING']);
  const unavailable=()=>({ok:false,code:'PAGE_NOT_READY',message:'官方页面尚未就绪，请完成登录或稍后读取。'});
  async function readReady() {
    const deadline=Date.now()+6000;
    for(let attempt=0;attempt<attempts;attempt++) {
      const result=await bridge.execute({type:'read'},region);
      if(result.ok && result.snapshot?.pageId && result.snapshot.pageId!==previous.pageId) return result;
      if(!result.ok && !pending.has(result.code)) return result;
      if(Date.now()>=deadline) break;
      if(attempt+1<attempts) await wait();
    }
    return unavailable();
  }
  if(typeof bridge.reconnectSite!=='function') return {ok:false,code:'CLIENT_REQUIRED',message:'当前客户端尚不支持重新连接。'};
  try {
    const reopened=await bridge.reconnectSite(region);
    if(!reopened.ok) return reopened;
    let result=await readReady();
    if(!result.ok) return result;
    if(result.needsListSelection && !previous.title) return {...result,code:'RECONNECTED_SELECT_LIST',message:result.snapshot.emptyAccount?'已重新连接，可以新建第一份清单。':'已重新连接，请选择清单。'};
    if(previous.title) {
      const lists=result.snapshot.lists.filter(list=>list.title===previous.title);
      if(lists.length!==1) return {...result,code:'RECONNECTED_SELECT_LIST',needsListSelection:true,message:'重新连接完成，请重新选择清单后继续编辑。'};
      const target=lists[0];
      if(result.snapshot.activeListId!==target.id) {
        const expectedPage=result.snapshot.pageId;
        const selected=await bridge.execute({type:'selectList',pageId:result.snapshot.pageId,listId:target.id},region);
        if(!selected.ok && !pending.has(selected.code)) return selected;
        result=selected.ok && selected.snapshot?selected:await readReady();
        if(!result.ok) return result;
        if(result.snapshot.pageId!==expectedPage || result.snapshot.activeListId!==target.id) return {ok:false,code:'STALE_VIEW',message:'清单位置已变化，请重新读取并选择清单。'};
      }
    }
    return {...result,code:'RECONNECTED',message:'已重新连接并读取当前清单，范围为网页已加载内容。'};
  } catch {return {ok:false,code:'RECONNECT_FAILED',message:'重新连接暂不可用，请在官方页面核对。'};}
}
