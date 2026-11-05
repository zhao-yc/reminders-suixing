/** 检查系统、当前框架与公开资源；可达不代表提醒事项服务或云端保存已确认。 */
async function readConnectionStatus(systemOnline,frame,options={}) {
  async function bounded(operation,fallback) {
    let timer;
    try {return await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>resolve(fallback),options.timeoutMs || 1800);})]);}
    finally {clearTimeout(timer);}
  }
  try {
    const system=systemOnline();
    if(system===false)return {ok:true,state:'offline'};
    if(system!==true || !frame)return {ok:true,state:'unknown'};
    const online=await bounded(frame.executeJavaScript('navigator.onLine'),null);
    if(online===false)return {ok:true,state:'offline'};
    if(online!==true || typeof options.probe!=='function')return {ok:true,state:'unknown'};
    try {return {ok:true,state:await bounded(Promise.resolve().then(options.probe),false)===true?'available':'unavailable'};}
    catch {return {ok:true,state:'unavailable'};}
  } catch {return {ok:true,state:'unknown'};}
}

/** 只向同源公开图标发 HEAD，省略凭据，不跟随重定向、不读响应正文。 */
function probePublicConnection(frame,url) {
  return frame.executeJavaScript('(async()=>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),1200);try{const response=await fetch('+JSON.stringify(url)+',{method:"HEAD",credentials:"omit",cache:"no-store",redirect:"manual",signal:controller.signal});return response.status>=100 || response.type==="opaqueredirect";}catch{return false;}finally{clearTimeout(timer);}})()');
}

module.exports={readConnectionStatus,probePublicConnection};
