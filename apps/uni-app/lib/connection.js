/** 只轮询固定连接状态，不读取事项；跨区域迟到结果与销毁后的结果均忽略。 */
export function connectionResult(result,type,interrupted) {
  if(result?.ok && interrupted && ['setCompleted','setText','createItem','setSchedule','setFlagged','deleteItem','createList','renameList','deleteList','setListAppearance','setSubtask'].includes(type))return {ok:false,code:'UNCERTAIN_WRITE',message:'连接发生中断，修改结果仍需核对；请刷新后确认，不要重复提交。',dispatched:typeof result.dispatched==='boolean'?result.dispatched:undefined,cloudConfirmed:false};
  return result;
}

export function monitorConnection(bridge,region,changed,options={}) {
  if(typeof bridge.connectionState!=='function')return ()=>{};
  let stopped=false,pending=false;
  const schedule=options.setInterval || globalThis.setInterval;
  const unschedule=options.clearInterval || globalThis.clearInterval;
  async function poll() {
    if(stopped || pending)return;
    pending=true;const current=region();
    try {
      const result=await bridge.connectionState(current);
      if(!stopped && current===region() && result?.ok && ['offline','unavailable','available','unknown'].includes(result.state))changed(result.state);
    } catch { /* 暂时不可读不推断网络已经恢复。 */ }
    finally {pending=false;}
  }
  const timer=schedule(poll,1000);poll();
  return ()=>{stopped=true;unschedule(timer);};
}
