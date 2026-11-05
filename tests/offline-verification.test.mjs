import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {offlineTestUI,verifyTestOffline} from '../apps/desktop/offline-verification.cjs';
import {summarize} from '../apps/desktop/live-check.cjs';

const before={pageId:'old-page',activeListId:'list',activeListTitle:'随行验证（2026-11-04）',lists:[{id:'list',title:'随行验证（2026-11-04）'}],items:[{id:'synthetic-private-id',title:'随行验证 · 最小读写验证',fingerprint:'synthetic-private-fingerprint'}]};

test('离线验证拒绝非专用内容，不改变会话网络',async()=>{
  const controller={lastWriteOutcome(){assert.fail('范围不匹配不继续验证');}};
  for(const snapshot of [{...before,activeListTitle:'合成普通清单'},{...before,items:[{title:'合成普通事项'}]}])assert.equal((await verifyTestOffline(controller,null,snapshot)).code,'TEST_OFFLINE_SCOPE_REQUIRED');
});

test('未观测到断网及模拟调用异常时，始终撤销本次网络模拟',async()=>{
  for(const fail of [false,true]){
    let enabled=0,disabled=0;
    const controller={lastWriteOutcome:()=>null,connectionState:async()=>({state:'available'}),window:()=>({webContents:{session:{enableNetworkEmulation(){enabled++;if(fail)throw Error('合成模拟失败');},disableNetworkEmulation(){disabled++;}}}})};
    const ui={webContents:{executeJavaScript:async()=>true}};
    if(fail)await assert.rejects(verifyTestOffline(controller,ui,before));
    else assert.equal((await verifyTestOffline(controller,ui,before)).code,'TEST_OFFLINE_NOT_OBSERVED');
    assert.equal(enabled,1);assert.equal(disabled,1);
  }
});

test('真实验收通道只调用指定读取和恢复，不派发事项写入且汇总不泄漏内容',async()=>{
  let offline=false,disabled=0;const commands=[];
  const controller={lastWriteOutcome:()=>null,connectionState:async()=>({state:offline?'unavailable':'available'}),window:()=>({webContents:{session:{enableNetworkEmulation(){offline=true;},disableNetworkEmulation(){offline=false;disabled++;}}}}),reconnectSite:async()=>({code:'CONNECTION_UNAVAILABLE'}),execute:async command=>{commands.push(command.type);if(offline)return {ok:false,code:'CONNECTION_UNAVAILABLE',dispatched:false};return {ok:true,snapshot:{...before,pageId:'new-page'}};}};
  const result=await verifyTestOffline(controller,{webContents:{executeJavaScript:async()=>true}},before);
  assert.equal(result.code,'TEST_OFFLINE_RECOVERED');assert.equal(disabled,1);assert.deepEqual(commands,['readList','readLists','readList']);
  const output=summarize(result);assert.equal(output.offlineTest.mode,'session-emulation');assert.ok(Object.entries(output.offlineTest).filter(([key])=>key!=='mode').every(([,value])=>value===true));assert.doesNotMatch(JSON.stringify(output),/synthetic-private|最小读写验证/);
});

test('公开资源故障仅匹配固定图标 HEAD，恢复时移除钩子，不读取请求内容',async()=>{
  let blocked=false,removed=0;const proxy={get(object,key){assert.equal(key,'method');return object[key];}};
  const webRequest={onBeforeRequest(filter,listener){if(filter===null){blocked=false;removed++;return;}assert.deepEqual(filter,{urls:['https://www.icloud.com.cn/favicon.ico']});for(const method of ['HEAD','GET'])listener(new Proxy({method},proxy),response=>assert.equal(response.cancel,method==='HEAD'));blocked=true;}};
  const controller={lastWriteOutcome:()=>null,connectionState:async()=>({state:blocked?'unavailable':'available'}),window:()=>({webContents:{session:{webRequest}}}),reconnectSite:async()=>({code:'CONNECTION_UNAVAILABLE'}),execute:async()=>blocked?{ok:false,code:'CONNECTION_UNAVAILABLE',dispatched:false}:{ok:true,snapshot:{...before,pageId:'new-page'}}};
  const result=await verifyTestOffline(controller,{webContents:{executeJavaScript:async()=>true}},before,'public-resource-fault');assert.equal(result.code,'TEST_PUBLIC_CONNECTION_RECOVERED');assert.equal(result.offlineTest.mode,'public-resource-fault');assert.equal(removed,1);assert.equal(blocked,false);
});

test('恢复验收通过 uni-app 控件单次刷新，未读回前不自动恢复可写',async t=>{
  const dom=new JSDOM('<div class="list-content" data-page-id="old-page" data-list-id="list" data-live="false"><div class="list-title">随行验证（2026-11-04）</div></div><div class="network-notice" data-state="read-required"></div><uni-button class="refresh-button"></uni-button>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const doc=dom.window.document;let clicks=0;
  doc.querySelector('.refresh-button').addEventListener('click',()=>{clicks++;doc.querySelector('.list-content').dataset.pageId='new-page';doc.querySelector('.list-content').dataset.live='true';doc.querySelector('.network-notice').remove();});
  assert.equal(await dom.window.eval('('+offlineTestUI.toString()+')('+JSON.stringify({pageId:'old-page',listId:'list',title:before.activeListTitle,stage:'restored'})+')'),true);assert.equal(clicks,0);
  assert.equal(await dom.window.eval('('+offlineTestUI.toString()+')('+JSON.stringify({pageId:'old-page',listId:'list',title:before.activeListTitle,stage:'refresh'})+')'),true);assert.equal(clicks,1);
});
