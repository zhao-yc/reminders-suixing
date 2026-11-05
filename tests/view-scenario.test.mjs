import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {classifyViewScenario,runViewScenario,inspectDatedTestViews,VIEW_SCENARIO_COMMANDS,VIEW_SCENARIO_WRITES} from '../apps/desktop/view-scenario.cjs';
import {isWriteTestCommand,summarize} from '../apps/desktop/live-check.cjs';

const titles=['随行验证 · 最小读写验证','随行验证 · Windows 新增验证','随行验证 · Windows 同步验证'];
const ALPHA='随行验证 · Windows 日期视图甲项',BETA='随行验证 · Windows 日期视图乙项';
const none={date:null,time:null,timeZone:null},day={date:'2024-02-29',time:null,timeZone:null};
const item=(title,id)=>({title,id,listId:'合成清单',fingerprint:id,completed:false,notes:'',flagged:false,priority:'none',level:1,parentId:null,schedule:none});
const base=()=>({pageId:'合成页面',activeListId:'合成清单',activeListTitle:'随行验证（2026-11-04）',lists:[{id:'合成清单',title:'随行验证（2026-11-04）'}],items:titles.map((title,index)=>item(title,'原项'+index))});
const pair=()=>({...base(),items:[...base().items,item(ALPHA,'甲'),item(BETA,'乙')]});
const env=snapshot=>{let outcome=null,clicks=0,after=snapshot;const commands=[];return {commands,get clicks(){return clicks;},setAfter:value=>after=value,controller:{lastWriteOutcome:()=>outcome,execute:async command=>{commands.push(command.type);if(command.type==='readLists')return {ok:true,snapshot:{pageId:snapshot.pageId,lists:[{id:snapshot.activeListId,title:snapshot.activeListTitle}]}};if(command.type==='readList')return {ok:true,snapshot:clicks?after:snapshot};if(command.type==='getSchedule')return {ok:true,snapshot,schedule:snapshot.items.find(item=>item.id===command.id).schedule};throw Error('非预期命令');}},options:{sendSnapshot(){},ui:{webContents:{executeJavaScript:async()=>{clicks++;outcome={sequence:1,ok:true,replyPending:false};return true;}}}},failWrite(){outcome={sequence:1,ok:false,code:'UNCERTAIN_WRITE',replyPending:false};}};};

test('新日期视图专项不复用旧事项，严格限定原三项和新甲乙，按实际顺序确认父子',()=>{
  assert.equal(classifyViewScenario(base()).state,'none');const flat=pair();assert.equal(classifyViewScenario(flat).state,'flat-empty');
  flat.items.reverse();const ordered=flat.items.filter(item=>[ALPHA,BETA].includes(item.title));
  ordered[1].schedule=day;assert.equal(classifyViewScenario(flat).child.id,'甲');assert.equal(classifyViewScenario(flat).state,'flat-dated');
  ordered[1].level=2;ordered[1].parentId=ordered[0].id;assert.equal(classifyViewScenario(flat).state,'nested-dated');
  for(const changed of [{...base(),activeListTitle:'个人清单'},{...base(),items:[...base().items,item('普通事项','隐私')]},{...base(),items:base().items.slice(1)}])assert.equal(classifyViewScenario(changed).state,'scope-invalid');
});

test('所有专项写入明确分类，读取和视图观察没有写权限，汇总不输出记录标识',()=>{
  for(const command of VIEW_SCENARIO_COMMANDS)assert.equal(isWriteTestCommand(command),VIEW_SCENARIO_WRITES.has(command));
  const result=summarize({ok:true,code:'VIEW_SCENARIO_READ',snapshot:base(),viewScenario:{state:'none',alphaCount:0,betaCount:0,id:'私密标识'}});
  assert.deepEqual(result.viewScenario,{state:'none',alphaCount:0,betaCount:0});assert.doesNotMatch(JSON.stringify(result),/私密标识|合成页面|合成清单|原项/);
  assert.equal(summarize({ok:false,code:'SUBTASK_UNAVAILABLE',subtaskStage:'active-editor'}).subtaskStage,'active-editor');
  assert.equal(summarize({ok:false,code:'SUBTASK_UNAVAILABLE',subtaskStage:'私密阶段内容'}).subtaskStage,undefined);
});

test('专项命令先读取导航和指定选区；非指定清单或同名时不读默认事项',async()=>{
  const commands=[];const controller={execute:async command=>{commands.push(command.type);return command.type==='readLists'?{ok:true,snapshot:{pageId:'合成页面',lists:[{title:base().activeListTitle,id:'合成清单'}]}}:{ok:false,code:'STALE_VIEW'};}};
  assert.equal((await runViewScenario(controller,'read-view-test-state',{})).code,'STALE_VIEW');assert.deepEqual(commands,['readLists','readList']);
  controller.execute=async command=>{assert.equal(command.type,'readLists');return {ok:true,snapshot:{lists:[{title:base().activeListTitle},{title:base().activeListTitle}]}};};
  assert.equal((await runViewScenario(controller,'set-view-test-day',{})).code,'TEST_LIST_NOT_UNIQUE');
});

test('创建只点击一次并要求正式回执，已有事项只读返回而不重建',async()=>{
  const fixture=env(base());fixture.setAfter({...base(),items:[...base().items,item(ALPHA,'甲')]});
  const result=await runViewScenario(fixture.controller,'create-view-test-alpha',fixture.options);
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.viewScenario.state,'alpha-only');assert.equal(fixture.clicks,1);assert.equal(result.cloudConfirmed,false);
  const existing=env({...base(),items:[...base().items,item(ALPHA,'甲')]});
  assert.equal((await runViewScenario(existing.controller,'create-view-test-alpha',existing.options)).code,'UNCHANGED');assert.equal(existing.clicks,0);
});

test('日期必须从空到固定过去日；错误顺序和不确定回执都不靠读回升级成功',async()=>{
  const flat=pair(),fixture=env(flat),after=structuredClone(flat);after.items[4].schedule=day;after.items[4].fingerprint='新日期指纹';fixture.setAfter(after);
  assert.equal((await runViewScenario(fixture.controller,'set-view-test-day',fixture.options)).viewScenario.state,'flat-dated');assert.equal(fixture.clicks,1);
  const wrong=env(flat);assert.equal((await runViewScenario(wrong.controller,'clear-view-test-day',wrong.options)).code,'TEST_VIEW_SCENARIO_STATE_REQUIRED');assert.equal(wrong.clicks,0);
  const uncertain=env(base());uncertain.setAfter({...base(),items:[...base().items,item(ALPHA,'甲')]});const original=uncertain.options.ui.webContents.executeJavaScript;
  uncertain.options.ui.webContents.executeJavaScript=async code=>{await original(code);uncertain.failWrite();return true;};
  assert.equal((await runViewScenario(uncertain.controller,'create-view-test-alpha',uncertain.options)).code,'UNCERTAIN_WRITE');assert.equal(uncertain.clicks,1);assert.deepEqual(uncertain.commands,['readLists','readList']);
});

test('真实视图观察只核对指定父子并恢复未完成，主项可编辑或多出记录都停止',async t=>{
  for(const broken of [false,true]) {
    const dom=new JSDOM('<div class="list-content" data-page-id="页" data-list-id="清单"></div><button class="view-tab" data-status="pending" aria-pressed="true"></button><button class="view-tab" data-status="today"></button><button class="view-tab" data-status="scheduled"></button><div id="rows"></div>',{runScripts:'outside-only'});t.after(()=>dom.window.close());dom.window.setTimeout=callback=>setTimeout(callback,0);
    const doc=dom.window.document,ids=['原一','原二','原三','父','子'];let selections=[];
    for(const tab of doc.querySelectorAll('.view-tab'))tab.onclick=()=>{selections.push(tab.dataset.status);doc.querySelectorAll('.view-tab').forEach(node=>node.setAttribute('aria-pressed',String(node===tab)));const dated=tab.dataset.status!=='pending';doc.getElementById('rows').innerHTML=dated?'<div class="date-view-description" data-view="'+tab.dataset.status+'" data-matches="1" data-unknown="1"></div><div class="reminder-row" data-record-id="父" data-view-context="true"><button class="completion-button" '+(broken?'':'disabled')+'></button></div><div class="reminder-row is-subtask" data-record-id="子" data-view-context="false"></div>':ids.map(id=>'<div class="reminder-row" data-record-id="'+id+'"></div>').join('');};
    const result=await dom.window.eval('('+inspectDatedTestViews.toString()+')('+JSON.stringify({pageId:'页',listId:'清单',parent:'父',child:'子',ids,unknown:1})+')');
    assert.equal(result,!broken);assert.equal(selections.at(-1),'pending');assert.equal(doc.querySelectorAll('.reminder-row').length,5);
  }
});
