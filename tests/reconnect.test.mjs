import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import { reopenOfficial } from '../apps/desktop/site-navigation.cjs';
import { reconnectLoadedList } from '../apps/uni-app/lib/reconnect.js';

const previous={title:'随行验证 · 同步清单',pageId:'old-page'};
const ready=(active='default-list',lists=[{id:'new-target',title:previous.title},{id:'default-list',title:'合成默认清单'}])=>({ok:true,code:'READY',snapshot:{pageId:'new-page',activeListId:active,activeListTitle:active==='new-target'?previous.title:'合成默认清单',lists,items:[]}});
const navigation=lists=>({...ready(undefined,lists),needsListSelection:true,snapshot:{...ready(undefined,lists).snapshot,activeListId:null,activeListTitle:''}});
const fast={wait:async()=>{},attempts:3};

test('空账户重新连接保留新建入口，不把没有清单当作当前空清单',async()=>{
  const bridge={reconnectSite:async()=>({ok:true}),execute:async()=>({ok:true,needsListSelection:true,snapshot:{pageId:'new-page',lists:[],items:[],activeListId:null,emptyAccount:true}})};
  const result=await reconnectLoadedList(bridge,'cn',{},fast);assert.equal(result.ok,true);assert.equal(result.needsListSelection,true);assert.match(result.message,/新建第一份清单/);
});

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
    if(command.type==='readLists') return reads++?navigation():{ok:false,code:'LIST_LOADING'};
    assert.equal(command.type,'selectList');return ready('new-target');
  }};
  const result=await reconnectLoadedList(bridge,'cn',previous,fast);
  assert.equal(result.code,'RECONNECTED');assert.equal(result.snapshot.activeListId,'new-target');
  assert.deepEqual(calls.at(-1),{type:'selectList',pageId:'new-page',listId:'new-target'});
  assert.equal(calls.filter(call=>Array.isArray(call)).length,1);
});

test('选择清单后仍加载时只重读，不重复选择或重新导航',async()=>{
  const calls=[];let reads=0;
  const bridge={reconnectSite:async()=>({ok:true}),execute:async command=>{calls.push(command.type);return command.type==='selectList'?{ok:false,code:'LIST_LOADING'}:command.type==='readLists'?navigation():ready('new-target');}};
  assert.equal((await reconnectLoadedList(bridge,'cn',previous,fast)).ok,true);
  assert.deepEqual(calls,['readLists','selectList','readList']);
});

test('清单同名或缺失时提供新快照但要求手动选择，不猜测旧清单身份',async()=>{
  for(const lists of [[{id:'one',title:previous.title},{id:'two',title:previous.title}],[]]) {
    const bridge={reconnectSite:async()=>({ok:true}),execute:async command=>{assert.equal(command.type,'readLists');return navigation(lists);}};
    const result=await reconnectLoadedList(bridge,'cn',previous,fast);
    assert.equal(result.code,'RECONNECTED_SELECT_LIST');assert.equal(result.needsListSelection,true);assert.equal(result.snapshot.pageId,'new-page');
  }
});

test('旧页面未替换、登录未就绪或重连失败时不恢复写权限，也不自动重开',async()=>{
  for(const result of [{ok:true,snapshot:{...ready().snapshot,pageId:previous.pageId}},{ok:false,code:'PAGE_NOT_READY'}]) {
    let opens=0,reads=0;
    const bridge={reconnectSite:async()=>{opens++;return {ok:true};},execute:async command=>{reads++;assert.equal(command.type,'readLists');return result;}};
    const failed=await reconnectLoadedList(bridge,'cn',previous,fast);
    assert.equal(failed.ok,false);assert.equal(opens,1);assert.equal(reads,3);assert.equal(failed.snapshot,undefined);
  }
  const failed=await reconnectLoadedList({reconnectSite:async()=>{throw Error('synthetic-private-error');}},'cn',previous,fast);
  assert.equal(failed.ok,false);assert.doesNotMatch(JSON.stringify(failed),/synthetic-private/);
});

test('恢复清单期间页面或选择被改变时停止，不用同名句柄继续操作',async()=>{
  const bridge={reconnectSite:async()=>({ok:true}),execute:async command=>command.type==='readLists'?navigation():{...ready('new-target'),snapshot:{...ready('new-target').snapshot,pageId:'another-page'}}};
  const result=await reconnectLoadedList(bridge,'cn',previous,fast);
  assert.equal(result.code,'STALE_VIEW');assert.equal(result.snapshot,undefined);
});

test('重连没有原清单时仅返回导航，不读取默认选中清单或自动选择',async()=>{
  const calls=[],bridge={reconnectSite:async()=>({ok:true}),execute:async command=>{calls.push(command.type);assert.equal(command.type,'readLists');return navigation();}};
  const result=await reconnectLoadedList(bridge,'cn',{},fast);assert.equal(result.code,'RECONNECTED_SELECT_LIST');assert.equal(result.snapshot.activeListId,null);assert.equal(result.snapshot.items.length,0);assert.deepEqual(calls,['readLists']);
});

test('选择尚未加载时只读取指定新页面和清单，忙碌读取可等待但不重选',async()=>{
  const calls=[];let reads=0;
  const bridge={reconnectSite:async()=>({ok:true}),execute:async command=>{calls.push(command);if(command.type==='readLists')return navigation();if(command.type==='selectList')return {ok:false,code:'LIST_LOADING'};assert.deepEqual(command,{type:'readList',pageId:'new-page',listId:'new-target'});return reads++?ready('new-target'):{ok:false,code:'BUSY'};}};
  assert.equal((await reconnectLoadedList(bridge,'cn',previous,fast)).code,'RECONNECTED');assert.equal(calls.filter(c=>c.type==='selectList').length,1);assert.equal(calls.some(c=>c.type==='read'),false);
});

test('选择后官方改选时停止，不读取或再次选择其他事项',async()=>{
  const calls=[],bridge={reconnectSite:async()=>({ok:true}),execute:async command=>{calls.push(command.type);if(command.type==='readLists')return navigation();return {ok:false,code:command.type==='selectList'?'LIST_LOADING':'STALE_VIEW'};}};
  assert.equal((await reconnectLoadedList(bridge,'cn',previous,fast)).code,'STALE_VIEW');assert.deepEqual(calls,['readLists','selectList','readList']);
});

test('官方阻止离开时不绕过 beforeunload、不继续导航，固定回执保留原因',async()=>{
  const contents=new EventEmitter();let calls=0;
  contents.loadURL=async()=>{calls++;contents.emit('will-prevent-unload',{preventDefault(){assert.fail('不能强制忽略官方离开保护');}});throw Object.assign(Error('synthetic-private-url ERR_ABORTED'),{code:'ERR_ABORTED',errno:-3});};
  const result=await reopenOfficial(contents,'https://www.icloud.com.cn/reminders/');
  assert.equal(result.code,'OFFICIAL_PAGE_BUSY');assert.equal(result.reconnectStage,'home');assert.equal(result.attempts[0].unloadPrevented,true);assert.equal(result.attempts[0].committed,false);assert.equal(result.attempts[0].errorKind,'ERR_ABORTED');assert.equal(calls,1);
  assert.equal(contents.listenerCount('will-prevent-unload'),0);assert.equal(contents.listenerCount('did-navigate'),0);assert.doesNotMatch(JSON.stringify(result),/synthetic-private/);
});

test('导航诊断只记录是否提交及固定错误，不保留目标 URL、异常正文或迟到监听',async()=>{
  const contents=new EventEmitter();contents.loadURL=async()=>{contents.emit('did-navigate',{},'https://example.invalid/synthetic-private');};
  const result=await reopenOfficial(contents,'https://www.icloud.com/reminders/');assert.equal(result.ok,true);assert.equal(result.attempts.length,2);assert.ok(result.attempts.every(step=>step.committed));assert.equal(contents.eventNames().length,0);assert.doesNotMatch(JSON.stringify(result),/example.invalid|synthetic-private/);
});

test('前端重连异常保留固定执行阶段，不输出异常正文',async()=>{
  const bridge={reconnectSite:async()=>({ok:true}),execute:async()=>{throw TypeError('synthetic-private-state');}};
  const result=await reconnectLoadedList(bridge,'cn',previous,fast);assert.equal(result.reconnectStage,'waiting-navigation');assert.equal(result.errorKind,'TypeError');assert.doesNotMatch(JSON.stringify(result),/synthetic-private/);
});
