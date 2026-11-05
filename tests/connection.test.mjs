import test from 'node:test';
import assert from 'node:assert/strict';
import {readConnectionStatus,probePublicConnection} from '../apps/desktop/connection.cjs';
import {monitorConnection,connectionResult} from '../apps/uni-app/lib/connection.js';
import vm from 'node:vm';

test('断网后迟到的写入成功回执保持不确定，不带旧快照关闭本地草稿',()=>{
  const observed={ok:true,code:'WEB_STATE_OBSERVED',snapshot:{private:'synthetic-private-snapshot'},dispatched:true,cloudConfirmed:false};
  const late=connectionResult(observed,'setText',true);assert.equal(late.ok,false);assert.equal(late.code,'UNCERTAIN_WRITE');assert.equal(late.dispatched,true);assert.equal(late.cloudConfirmed,false);assert.equal(late.snapshot,undefined);assert.equal(observed.ok,true);
  assert.equal(connectionResult(observed,'setText',false),observed);assert.equal(connectionResult(observed,'read',true),observed);
});

test('系统离线不执行网页脚本，系统可用仍需只读当前框架布尔值',async()=>{
  let calls=0;const frame={executeJavaScript:async script=>{calls++;assert.equal(script,'navigator.onLine');return false;}};
  assert.equal((await readConnectionStatus(()=>false,frame)).state,'offline');assert.equal(calls,0);
  assert.equal((await readConnectionStatus(()=>true,frame)).state,'offline');assert.equal(calls,1);
  assert.equal((await readConnectionStatus(()=>true,{executeJavaScript:async()=>true},{probe:async()=>true})).state,'available');
  assert.equal((await readConnectionStatus(()=>true,{executeJavaScript:async()=>true},{probe:async()=>false})).state,'unavailable');
  assert.equal((await readConnectionStatus(()=>true,{executeJavaScript:async()=>true})).state,'unknown');
  assert.equal((await readConnectionStatus(()=>true,null)).state,'unknown');
});

test('网络状态未知、异常、超时和迟到失败不泄漏信息、不重试或宣称已连接',async()=>{
  for(const frame of [{executeJavaScript:async()=>({private:'synthetic-private-value'})},{executeJavaScript:async()=>{throw Error('synthetic-private-error');}}])assert.deepEqual(await readConnectionStatus(()=>true,frame),{ok:true,state:'unknown'});
  let reject,calls=0;assert.equal((await readConnectionStatus(()=>true,{executeJavaScript(){calls++;return new Promise((resolve,fail)=>reject=fail);}},{timeoutMs:10})).state,'unknown');reject(Error('synthetic-private-late'));assert.equal(calls,1);
});

test('公开资源检查省略凭据、不跟随跳转或读正文，HTTP 错误仍只证明网络可达',async()=>{
  let calls=0;
  const frame={executeJavaScript:script=>vm.runInNewContext(script,{AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
    calls++;assert.equal(url,'https://www.icloud.com/favicon.ico');assert.equal(options.method,'HEAD');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);assert.equal(options.headers,undefined);
    const response={status:404,text(){assert.fail('不能读取响应正文');}};Object.defineProperty(response,'headers',{get(){assert.fail('不能读取响应头');}});return response;
  }})};
  assert.equal(await probePublicConnection(frame,'https://www.icloud.com/favicon.ico'),true);assert.equal(calls,1);
  assert.equal((await readConnectionStatus(()=>true,{executeJavaScript:async()=>true},{probe:async()=>{throw Error('synthetic-private-network-error');}})).state,'unavailable');
});

test('连接轮询不并发，不读取事项，跨区域迟到及销毁后的结果不更新界面',async()=>{
  let poll,finish,region='cn',cleared=false;const calls=[],changes=[];
  const bridge={execute(){assert.fail('网络监测不能读取或写入事项');},connectionState:area=>{calls.push(area);return new Promise(resolve=>finish=resolve);}};
  const stop=monitorConnection(bridge,()=>region,state=>changes.push(state),{setInterval:fn=>{poll=fn;return 1;},clearInterval:id=>{assert.equal(id,1);cleared=true;}});
  await poll();assert.deepEqual(calls,['cn']);region='global';finish({ok:true,state:'offline'});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(changes,[]);
  const pending=poll();finish({ok:true,state:'available'});await pending;assert.deepEqual(calls,['cn','global']);assert.deepEqual(changes,['available']);
  const late=poll();stop();finish({ok:true,state:'offline'});await late;assert.deepEqual(changes,['available']);assert.equal(cleared,true);
});
