/** 在同一官方容器内回到入口再进入提醒事项；不清理存储或更换会话。 */
async function reopenOfficial(contents, destination, timeoutMs = 12000) {
  let home;
  try {home=new URL('/',destination).href;}
  catch {return {ok:false,code:'RECONNECT_FAILED',message:'官方入口无效，请重新选择服务区域。'};}
  return navigateOfficial(contents, destination, [['home',home],['reminders',destination]], timeoutMs);
}

/** 定向自动更新只重开提醒事项入口，不经过账号首页。 */
function reloadOfficial(contents, destination) {
  return navigateOfficial(contents, destination, [['reminders',destination]], 12000);
}

async function navigateOfficial(contents, destination, steps, timeoutMs) {
  const attempts=[];
  for (const [stage,url] of steps) {
    let timer,timedOut=false;
    const attempt={stage,committed:false,unloadPrevented:false};attempts.push(attempt);
    const prevented=()=>{attempt.unloadPrevented=true;};
    const committed=(_event,value)=>{attempt.committed=true;try{const actual=new URL(value),entry=new URL(destination);attempt.routeKind=actual.origin!==entry.origin?'other-origin':actual.pathname==='/'?'home':actual.pathname.replace(/\/$/,'')===entry.pathname.replace(/\/$/,'')?'reminders':'other-path';}catch{attempt.routeKind='unknown';}};
    const inPage=()=>{attempt.inPageNavigation=true;};
    contents.on?.('will-prevent-unload',prevented);
    contents.on?.('did-navigate',committed);
    contents.on?.('did-navigate-in-page',inPage);
    try {
      const operation=Promise.resolve().then(()=>contents.loadURL(url));
      const timeout=new Promise((resolve,reject)=>{
        timer=setTimeout(()=>{timedOut=true;try{contents.stop();}catch{}reject(new Error('RECONNECT_TIMEOUT'));},timeoutMs);
      });
      await Promise.race([operation,timeout]);
      if(attempt.unloadPrevented)throw new Error('OFFICIAL_PAGE_BUSY');
    } catch(error) {
      const known=['ERR_ABORTED','ERR_BLOCKED_BY_CLIENT','ERR_INTERNET_DISCONNECTED','ERR_NAME_NOT_RESOLVED','ERR_FAILED'];
      attempt.errorKind=known.find(code=>error?.code===code || String(error?.message || '').includes(code)) || 'OTHER';
      if(Number.isInteger(error?.errno) && Math.abs(error.errno)<10000)attempt.errorNumber=error.errno;
      return {ok:false,code:attempt.unloadPrevented?'OFFICIAL_PAGE_BUSY':timedOut?'RECONNECT_TIMEOUT':'RECONNECT_FAILED',reconnectStage:attempt.stage,attempts,
        message:attempt.unloadPrevented?'官方页面阻止离开，可能仍在编辑或同步，请先打开官方页面核对。':timedOut?'重新连接超时，请稍后读取或打开官方页面核对。':'重新连接未完成，请打开官方页面核对。'};
    } finally {clearTimeout(timer);contents.removeListener?.('will-prevent-unload',prevented);contents.removeListener?.('did-navigate',committed);contents.removeListener?.('did-navigate-in-page',inPage);}
  }
  return {ok:true,code:'SITE_REOPENED',attempts};
}

module.exports={reopenOfficial,reloadOfficial};
