/** 在同一官方容器内回到入口再进入提醒事项；不清理存储或更换会话。 */
async function reopenOfficial(contents, destination, timeoutMs = 12000) {
  let home;
  try {home=new URL('/',destination).href;}
  catch {return {ok:false,code:'RECONNECT_FAILED',message:'官方入口无效，请重新选择服务区域。'};}
  for (const url of [home,destination]) {
    let timer,timedOut=false;
    try {
      const operation=Promise.resolve().then(()=>contents.loadURL(url));
      const timeout=new Promise((resolve,reject)=>{
        timer=setTimeout(()=>{timedOut=true;try{contents.stop();}catch{}reject(new Error('RECONNECT_TIMEOUT'));},timeoutMs);
      });
      await Promise.race([operation,timeout]);
    } catch {
      return {ok:false,code:timedOut?'RECONNECT_TIMEOUT':'RECONNECT_FAILED',message:timedOut?'重新连接超时，请稍后读取或打开官方页面核对。':'重新连接未完成，请打开官方页面核对。'};
    } finally {clearTimeout(timer);}
  }
  return {ok:true,code:'SITE_REOPENED'};
}

module.exports={reopenOfficial};
