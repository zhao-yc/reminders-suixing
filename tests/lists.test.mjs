import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validCommand} from '../apps/desktop/policy.cjs';

const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');
async function setup(t) {
  const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});t.after(()=>dom.window.close());dom.window.eval(source);
  const execute=command=>dom.window.__suixingAdapter.execute(command),snapshot=(await execute({type:'read'})).snapshot;
  return {window:dom.window,execute,snapshot};
}
function command(snapshot,type='createList',value='随行验证 · 合成新清单') {
  const list=snapshot.lists.find(list=>list.id===snapshot.activeListId);
  return {type,pageId:snapshot.pageId,listId:list.id,expectedListFingerprint:list.fingerprint,value,requestId:'synthetic-list-once'};
}

test('新建清单仅输入名称和完成各一次，选中新空清单，保留原清单，HTML 作为文字',async t=>{
  const {window,execute,snapshot}=await setup(t);const value='随行验证 · <img src=x onerror=alert(1)>';
  const result=await execute(command(snapshot,'createList',value));
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.cloudConfirmed,false);
  assert.equal(result.snapshot.lists.length,3);assert.equal(result.snapshot.activeListTitle,value);assert.equal(result.snapshot.items.length,0);
  for(const old of snapshot.lists)assert.ok(result.snapshot.lists.some(list=>list.fingerprint===old.fingerprint));
  assert.equal(window.document.querySelector('img'),null);assert.equal(window.fixtureListInputs,1);assert.equal(window.fixtureListSaves,1);assert.equal(window.fixtureCreationClicks,0);
  assert.equal((await execute(command(snapshot,'createList',value))).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureListSaves,1);
});

test('新建允许同名清单，按新增句柄识别，不把已有同名清单当作成功',async t=>{
  const {execute,snapshot}=await setup(t);const value=snapshot.activeListTitle;
  const result=await execute(command(snapshot,'createList',value));assert.equal(result.ok,true);
  assert.equal(result.snapshot.lists.filter(list=>list.title===value).length,3);
  assert.ok(!snapshot.lists.some(list=>list.id===result.snapshot.activeListId));
});

test('新建弹窗读取草稿选项后取消，名称和选定外观通过同一次完成提交',async t=>{
  const {window,execute,snapshot}=await setup(t);
  const request=command(snapshot);
  const options={type:'getListCreateOptions',pageId:request.pageId,listId:request.listId,expectedListFingerprint:request.expectedListFingerprint};
  assert.equal(validCommand(options),true);
  const reply=await execute(options);
  assert.equal(reply.code,'LIST_CREATE_OPTIONS');assert.equal(reply.dispatched,false);
  assert.equal(window.fixtureListCancels,1);assert.equal(window.fixtureListInputs,0);assert.equal(window.fixtureListSaves,0);
  assert.equal(window.document.querySelector('.reminder-list-detail'),null);
  const {colors,icons,fingerprint}=reply.appearance;
  const appearance={color:colors[1].key,iconKey:icons[1].key,expectedAppearanceFingerprint:fingerprint};
  assert.equal(validCommand({...request,appearance}),true);
  const result=await execute({...request,appearance});
  assert.equal(result.code,'WEB_STATE_OBSERVED');
  const added=result.snapshot.lists.find(list=>list.id===result.snapshot.activeListId);
  assert.equal(added.title,request.value);assert.equal(added.color,appearance.color);assert.equal(added.icon.key,appearance.iconKey);
  assert.equal(window.fixtureAppearanceClicks,2);assert.equal(window.fixtureListInputs,1);assert.equal(window.fixtureListSaves,1);
  assert.equal((await execute({...request,appearance})).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureListSaves,1);
  const renamed=await execute({...command(result.snapshot,'renameList','随行验证 · 新建后改名'),requestId:'synthetic-list-rename-once'});
  assert.equal(renamed.code,'WEB_STATE_OBSERVED');
  const afterRename=renamed.snapshot.lists.find(list=>list.id===added.id);
  assert.equal(afterRename.color,appearance.color);assert.equal(afterRename.icon.key,appearance.iconKey);
});

test('新建草稿外观选项变化时取消，名称和完成均不提交',async t=>{
  const {window,execute,snapshot}=await setup(t);
  const request=command(snapshot);
  const {appearance}=await execute({...request,type:'getListCreateOptions'});
  window.fixtureAfterAppearanceOpen=panel=>panel.querySelector('.color-picker button:last-child').remove();
  const result=await execute({...request,appearance:{color:appearance.colors[1].key,iconKey:appearance.icons[1].key,expectedAppearanceFingerprint:appearance.fingerprint}});
  assert.equal(result.code,'STALE_VIEW');assert.equal(result.dispatched,false);
  assert.equal(window.fixtureListCancels,2);assert.equal(window.fixtureListInputs,0);assert.equal(window.fixtureListSaves,0);
});

test('同名清单只重命名当前句柄，其他清单、颜色与事项指纹保持',async t=>{
  const {window,execute,snapshot}=await setup(t);const result=await execute(command(snapshot,'renameList','随行验证 · 新名称'));
  assert.equal(result.code,'WEB_STATE_OBSERVED');assert.equal(result.snapshot.activeListId,snapshot.activeListId);
  assert.equal(result.snapshot.lists[0].title,'随行验证 · 新名称');assert.equal(result.snapshot.lists[0].color,snapshot.lists[0].color);
  assert.equal(result.snapshot.lists[1].fingerprint,snapshot.lists[1].fingerprint);
  assert.deepEqual(result.snapshot.items.map(item=>item.fingerprint),snapshot.items.map(item=>item.fingerprint));
  assert.equal(window.fixtureListInputs,1);assert.equal(window.fixtureListSaves,1);assert.equal(window.sessionStorage.getItem('fixture-list-name-one'),'随行验证 · 新名称');
});

test('名称未变时只读返回，清单名称变动后旧指纹拒绝修改',async t=>{
  const {window,execute,snapshot}=await setup(t);
  assert.equal((await execute(command(snapshot,'renameList',snapshot.activeListTitle))).code,'UNCHANGED');assert.equal(window.fixtureListSaves,0);
  const selected=window.document.querySelector('[role="treeitem"][aria-selected="true"]');selected.querySelector('.inline-editable-label').textContent='随行验证 · 外部改名';
  assert.equal((await execute(command(snapshot))).code,'STALE_VIEW');assert.equal(window.document.querySelector('.reminder-list-detail'),null);
});

test('无效名称、确认句柄和请求标识在协议及适配器均拒绝',async t=>{
  const {window,execute,snapshot}=await setup(t);
  for(const value of ['', '  ', '换行\n名称','长'.repeat(101)]) {const request=command(snapshot,'createList',value);assert.equal(validCommand(request),false);assert.equal((await execute(request)).code,'INVALID_COMMAND');}
  for(const changes of [{requestId:'not valid'},{expectedListFingerprint:''}])assert.equal(validCommand({...command(snapshot),...changes}),false);
  assert.equal(validCommand(command(snapshot)),true);assert.equal(window.fixtureListSaves,0);
});

test('不接管已有官方编辑窗口，也不在其他清单或旧页面上修改名称',async t=>{
  const {window,execute,snapshot}=await setup(t);
  assert.equal((await execute({...command(snapshot),pageId:'old-page'})).code,'STALE_VIEW');
  window.document.body.insertAdjacentHTML('beforeend','<div class="reminder-list-detail"><button class="cancel-button"></button></div>');
  assert.equal((await execute(command(snapshot))).code,'LIST_UNAVAILABLE');assert.equal(window.fixtureListCancels,0);assert.equal(window.fixtureListSaves,0);
});

test('输入被官方控件拒绝时取消草稿，不点击完成，不回退为其他输入方式',async t=>{
  const {window,execute,snapshot}=await setup(t);window.fixtureListRejectInput=true;
  assert.equal((await execute(command(snapshot))).code,'UNCERTAIN_WRITE');assert.equal(window.fixtureListInputs,0);assert.equal(window.fixtureListSaves,0);assert.equal(window.fixtureListCancels,1);
});

test('完成后无回执返回不确定，读回后原请求仍不再次提交',async t=>{
  const {window,execute,snapshot}=await setup(t);window.fixtureListRejectDone=true;
  assert.equal((await execute(command(snapshot))).code,'UNCERTAIN_WRITE');assert.equal(window.fixtureListSaves,1);
  await execute({type:'read'});assert.equal((await execute(command(snapshot))).code,'ALREADY_SUBMITTED');assert.equal(window.fixtureListSaves,1);
});

test('重命名时其他清单并发变化，不把部分更新当作精确保存回执',async t=>{
  const {window,execute,snapshot}=await setup(t);
  window.fixtureAfterListSave=()=>{window.document.querySelectorAll('.inline-editable-label')[1].textContent='随行验证 · 合成并发改名';};
  assert.equal((await execute(command(snapshot,'renameList','随行验证 · 新名称'))).code,'UNCERTAIN_WRITE');assert.equal(window.fixtureListSaves,1);
});
