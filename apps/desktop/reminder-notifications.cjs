const clockPattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const validClock=value=>typeof value==='string' && clockPattern.test(value);
const formatters=new Map(),instantCache=new Map();
function validDate(value) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [y,m,d]=value.split('-').map(Number),days=[31,y%4===0 && (y%100!==0 || y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  return y>=1 && m>=1 && m<=12 && d>=1 && d<=days[m-1];
}
function zonedMinute(time,zone) {
  try {
    if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
    const parts=Object.fromEntries(formatters.get(zone).formatToParts(time).map(part=>[part.type,part.value]));
    return parts.year.padStart(4,'0')+'-'+parts.month+'-'+parts.day+' '+parts.hour+':'+parts.minute;
  } catch {return null;}
}

/** 回验目标墙上时间的实际瞬间；跳过时钟缺口与无偏移信息的重复小时。 */
function wallInstants(date,time,zone) {
  const key=JSON.stringify([date,time,zone]);if(instantCache.has(key))return instantCache.get(key);
  const guessed=Date.parse(date+'T'+time+':00Z'),found=new Set();
  for(let hours=-36;hours<=36;hours+=6) {
    const probe=guessed+hours*3600000,wall=zonedMinute(probe,zone);if(!wall)continue;
    const offset=Date.parse(wall.replace(' ','T')+':00Z')-probe,instant=guessed-offset;
    if(zonedMinute(instant,zone)===date+' '+time)found.add(instant);
  }
  const values=[...found].sort((a,b)=>a-b);if(instantCache.size>=5000)instantCache.delete(instantCache.keys().next().value);instantCache.set(key,values);return values;
}

/** 只按实际读到的这一轮日期判断，不推算重复规则，也不从附注猜测。 */
function dueOccurrences(snapshot,{now,from,allDayTime,localZone}) {
  const events=[];let unknownDates=0;
  for(const item of snapshot.items) {
    if(item.completed!==false)continue;
    const schedule=item.schedule;
    if(schedule?.date===null && schedule.time===null && schedule.timeZone===null)continue;
    if(!schedule || !validDate(schedule.date) || !(schedule.time===null && schedule.timeZone===null || validClock(schedule.time) && typeof schedule.timeZone==='string')){unknownDates++;continue;}
    const time=schedule.time===null?allDayTime:schedule.time,zone=schedule.time===null?localZone:schedule.timeZone;
    const instants=wallInstants(schedule.date,time,zone);
    if(!instants.length || schedule.time!==null && instants.length!==1){unknownDates++;continue;}
    // 全天是用户定义的本地时钟，重复小时只取第一次；云端指定时间无偏移则不猜。
    const instant=instants[0];
    if(from<instant && instant<=now)events.push(JSON.stringify([item.id,schedule.date,time,schedule.time===null?'local':zone]));
  }
  return {events,unknownDates};
}

/** 主进程定时读同一清单；只保存去重键，不保存正文或事项副本。 */
function createReminderNotifications({read,show,changed=()=>{},now=Date.now,localZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone,setInterval=global.setInterval,clearInterval=global.clearInterval}) {
  let enabled=false,allDayTime='09:00',enabledAt=0,context=null,revision=0,pending=false,stopped=false,faultGeneration=null;
  let phase='off',code='',unknownDates=0,lastDeliveryUnconfirmed=false;
  const delivered=new Map();
  const state=()=>({enabled,allDayTime,phase,code,unknownDates,lastDeliveryUnconfirmed});
  function publish(next,nextCode='') {phase=next;code=nextCode;changed(state());}
  function configure(value) {
    if(typeof value?.enabled!=='boolean' || !validClock(value.allDayTime))return {ok:false,code:'INVALID_REQUEST'};
    if(value.enabled && !enabled)enabledAt=now();
    enabled=value.enabled;allDayTime=value.allDayTime;lastDeliveryUnconfirmed=false;revision++;publish(enabled?'paused':'off');return {ok:true,...state()};
  }
  function updateContext(value) {
    if(!value || !['cn','global'].includes(value.region) || !['ready','busy','editing'].every(key=>typeof value[key]==='boolean') ||
      !Number.isSafeInteger(value.readGeneration) || value.readGeneration<0 || !['pageId','listId'].every(key=>typeof value[key]==='string' && value[key].length<=150))return {ok:false,code:'INVALID_REQUEST'};
    const next={region:value.region,accountId:value.accountId,ready:value.ready,busy:value.busy,editing:value.editing,pageId:value.pageId,listId:value.listId,readGeneration:value.readGeneration};
    if(JSON.stringify(next)!==JSON.stringify(context)) {
      if(!context || next.region!==context.region || next.accountId!==context.accountId || next.pageId!==context.pageId || next.listId!==context.listId || next.readGeneration!==context.readGeneration)faultGeneration=null;
      context=next;revision++;
    }
    return {ok:true};
  }
  async function tick() {
    if(stopped || pending || !enabled)return;
    if(!context?.ready || context.busy || context.editing || !context.pageId || !context.listId || faultGeneration!==null){publish('paused',faultGeneration!==null?'READ_REQUIRED':'');return;}
    pending=true;const before={...context},current=revision;
    const valid=()=>!stopped && enabled && current===revision;
    publish('checking');
    try {
      const scope=before.accountId?[before.region,before.accountId]:[before.region];
      const result=await read({type:'readList',pageId:before.pageId,listId:before.listId,background:true},...scope);
      if(!valid())return;
      if(['BUSY','AUTO_READ_DEFERRED'].includes(result?.code)){publish('paused');return;}
      const snapshot=result?.snapshot;
      if(!result?.ok || snapshot?.pageId!==before.pageId || snapshot.activeListId!==before.listId || !Array.isArray(snapshot.items) ||
        snapshot.items.some(item=>typeof item.id!=='string' || !item.id) || new Set(snapshot.items.map(item=>item.id)).size!==snapshot.items.length) {
        faultGeneration=before.readGeneration;publish('unavailable','READ_REQUIRED');return;
      }
      const time=now();
      const due=dueOccurrences(snapshot,{now:time,from:enabledAt,allDayTime,localZone:localZone()});unknownDates=due.unknownDates;
      const events=due.events.map(key=>(before.accountId || before.region)+':'+key).filter(key=>!delivered.has(key));
      // 启用前已经进入的分钟不补发；同一进程恢复、切换清单或回拨时钟不重播。
      for(const key of events)delivered.set(key,time);
      if(!events.length){publish('ready');return;}
      // 先消费本轮，系统显示失败或超时都不自动重发。
      const shown=await show(events.length);
      if(valid()){lastDeliveryUnconfirmed=!shown?.ok;publish(shown?.ok?'ready':'failed',shown?.ok?'NOTIFICATION_SHOWN':'NOTIFICATION_UNCONFIRMED');}
    } catch {
      if(valid()){faultGeneration=before.readGeneration;publish('unavailable','READ_REQUIRED');}
    } finally {pending=false;}
  }
  const timer=setInterval(tick,15000);
  return {configure,updateContext,tick,state,stop(){stopped=true;revision++;clearInterval(timer);}};
}
module.exports={createReminderNotifications,dueOccurrences,validClock};
