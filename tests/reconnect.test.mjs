import test from 'node:test';
import assert from 'node:assert/strict';
import { reopenOfficial } from '../apps/desktop/site-navigation.cjs';
import { reconnectLoadedList } from '../apps/uni-app/lib/reconnect.js';

const previous={title:'随行验证 · 同步清单',pageId:'old-page'};
const ready=(active='default-list',lists=[{id:'new-target',title:previous.title},{id:'default-list',title:'合成默认清单'}])=>({ok:true,code:'READY',snapshot:{pageId:'new-page',activeListId:active,lists,items:[]}});
const fast={wait:async()=>{},attempts:3};

test('官方重连只在同一容器导航两个固定地址，不读或清理会话数据',async()=>{
  const calls=[],contents={loadURL:async url=>calls.push(url),stop(){assert.fail('成功导航无需停止');}};
  Object.defineProperty(contents,'session',{get(){assert.fail('不读取会话或凭据');}});
  assert.equal((await reopenOfficial(contents,'https://www.icloud.com.cn/reminders/')).ok,true);
  assert.deepEqual(calls,['https://www.icloud.com.cn/','https://www.icloud.com.cn/reminders/']);
});

test('官方导航失败不继续下一步，不泄漏底层错误或自动重试',async()=>{
  let calls=0;
  const result=await reopenOfficial({loadURL(){calls++;return Promise.reject(Error('synthetic-private-token'));}},'https://www.icloud.com/reminders/');
  assert.equal(result.code,'RECONNECT_FAILED');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/synthetic-private/);
});

test('导航超时只停止本次加载，迟到失败不会重放导航',async()=>{
  let reject,calls=0,stops=0;
  const result=await reopenOfficial({loadURL(){calls++;return new Promise((resolve,fail)=>reject=fail);},stop(){stops++;}},'https://www.icloud.com/reminders/',10);
  assert.equal(result.code,'RECONNECT_TIMEOUT');assert.equal(calls,1);assert.equal(stops,1);
  reject(Error('合成迟到错误'));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
});

test('重新连接后只读等待新页面，并以新句柄恢复唯一清单',async()=>{
  const calls=[];let reads=0;
  const bridge={reconnectSite:async region=>{calls.push(['reconnect',region]);return {ok:true};},execute:async command=>{
    calls.push(command);
    if(command.type==='read') return reads++?ready():{ok:false,code:'LIST_LOADING'};
    assert.equal(command.type,'selectList');return ready('new-target');
  }};
  const result=await reconnectLoadedList(bridge,'cn',previous,fast);
  assert.equal(result.code,'RECONNECTED');assert.equal(result.snapshot.activeListId,'new-target');
  assert.deepEqual(calls.at(-1),{type:'selectList',pageId:'new-page',listId:'new-target'});
  assert.equal(calls.filter(call=>Array.isArray(call)).length,1);
});

test('选择清单后仍加载时只重读，不重复选择或重新导航',async()=>{
  const calls=[];let reads=0;
  const bridge={reconnectSite:async()=>({ok:true}),execute:async command=>{calls.push(command.type);return command.type==='selectList'?{ok:false,code:'LIST_LOADING'}:ready(reads++?'new-target':'default-list');}};
  assert.equal((await reconnectLoadedList(bridge,'cn',previous,fast)).ok,true);
  assert.deepEqual(calls,['read','selectList','read']);
});

test('清单同名或缺失时提供新快照但要求手动选择，不猜测旧清单身份',async()=>{
  for(const lists of [[{id:'one',title:previous.title},{id:'two',title:previous.title}],[]]) {
    const bridge={reconnectSite:async()=>({ok:true}),execute:async command=>{assert.equal(command.type,'read');return ready('default-list',lists);}};
    const result=await reconnectLoadedList(bridge,'cn',previous,fast);
    assert.equal(result.code,'RECONNECTED_SELECT_LIST');assert.equal(result.needsListSelection,true);assert.equal(result.snapshot.pageId,'new-page');
  }
});

test('旧页面未替换、登录未就绪或重连失败时不恢复写权限，也不自动重开',async()=>{
  for(const result of [{ok:true,snapshot:{...ready().snapshot,pageId:previous.pageId}},{ok:false,code:'PAGE_NOT_READY'}]) {
    let opens=0,reads=0;
    const bridge={reconnectSite:async()=>{opens++;return {ok:true};},execute:async command=>{reads++;assert.equal(command.type,'read');return result;}};
    const failed=await reconnectLoadedList(bridge,'cn',previous,fast);
    assert.equal(failed.ok,false);assert.equal(opens,1);assert.equal(reads,3);assert.equal(failed.snapshot,undefined);
  }
  const failed=await reconnectLoadedList({reconnectSite:async()=>{throw Error('synthetic-private-error');}},'cn',previous,fast);
  assert.equal(failed.ok,false);assert.doesNotMatch(JSON.stringify(failed),/synthetic-private/);
});

test('恢复清单期间页面或选择被改变时停止，不用同名句柄继续操作',async()=>{
  const bridge={reconnectSite:async()=>({ok:true}),execute:async command=>command.type==='read'?ready():{...ready('new-target'),snapshot:{...ready('new-target').snapshot,pageId:'another-page'}}};
  const result=await reconnectLoadedList(bridge,'cn',previous,fast);
  assert.equal(result.code,'STALE_VIEW');assert.equal(result.snapshot,undefined);
});
