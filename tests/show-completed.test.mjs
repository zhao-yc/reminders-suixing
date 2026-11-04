import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validCommand} from '../apps/desktop/policy.cjs';

const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');

async function setup(t) {
  const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});
  t.after(()=>dom.window.close());
  const window=dom.window;
  window.sessionStorage.setItem('fixture-complete','true');
  window.fixtureHideCompleted=true;
  window.renderFixture('one');
  window.eval(source);
  const execute=command=>window.__suixingAdapter.execute(command);
  const {snapshot}=await execute({type:'read'});
  return {window,execute,snapshot,command:{type:'showCompleted',pageId:snapshot.pageId,listId:snapshot.activeListId}};
}

test('已完成入口展开官方隐藏事项，重复请求不会反转或修改完成状态',async t=>{
  const {window,execute,snapshot,command}=await setup(t);
  assert.equal(snapshot.items.length,1);
  const first=await execute(command);
  assert.equal(first.code,'VIEW_REQUESTED');
  assert.equal(first.snapshot.items.length,2);
  assert.equal(first.snapshot.items.filter(item=>item.completed).length,1);
  assert.match(first.snapshot.coverage,/已加载/);
  const second=await execute(command);
  assert.equal(second.ok,true);
  assert.equal(second.snapshot.items.length,2);
  assert.equal(window.fixtureCompletedActionClicks,1);
  assert.equal(window.fixtureClicks,0);
  assert.equal(window.sessionStorage.getItem('fixture-complete'),'true');
});

test('旧页面、其他清单和加载期间都不打开官方菜单',async t=>{
  const {window,execute,command}=await setup(t);
  assert.equal((await execute({...command,pageId:'synthetic-old-page'})).code,'STALE_VIEW');
  assert.equal((await execute({...command,listId:'synthetic-other-list'})).code,'STALE_VIEW');
  window.document.querySelector('[role="treegrid"]').setAttribute('aria-busy','true');
  assert.equal((await execute(command)).code,'LIST_LOADING');
  assert.equal(window.fixtureCompletedMenuClicks,0);
  assert.equal(window.fixtureCompletedActionClicks,0);
});

test('菜单打开时清单变化，禁止继续激活旧清单动作',async t=>{
  const {window,execute,command}=await setup(t);
  window.document.querySelector('.list-detail-button').addEventListener('click',()=>{
    window.document.querySelectorAll('[role="treeitem"]').forEach(node=>node.setAttribute('aria-selected',String(node.dataset.list==='two')));
  });
  assert.equal((await execute(command)).code,'STALE_VIEW');
  assert.equal(window.fixtureCompletedActionClicks,0);
  assert.equal(window.fixtureClicks,0);
});

test('无法唯一定位显示菜单时拒绝猜测，不能点击隐藏或清除已完成',async t=>{
  const {window,execute,command}=await setup(t);
  const menu=window.document.querySelector('.fixture-list-menu');
  menu.hidden=false;
  menu.innerHTML='<button role="menuitem">显示已完成的项目</button><button role="menuitem">显示已完成的提醒事项</button><button role="menuitem">清除已完成的项目</button>';
  let clicks=0;
  menu.addEventListener('click',()=>clicks++);
  assert.equal((await execute(command)).code,'VIEW_UNAVAILABLE');
  assert.equal(clicks,0);
  assert.equal(window.fixtureClicks,0);
});

test('显示菜单不可用或被禁用时明确要求官方核对',async t=>{
  const {window,execute,command}=await setup(t);
  window.document.querySelector('.list-detail-button').disabled=true;
  assert.equal((await execute(command)).code,'VIEW_UNAVAILABLE');
  assert.equal(window.fixtureCompletedMenuClicks,0);
});

test('桌面显示完成项命令必须携带当前页面与清单，不接受任意动作',()=>{
  assert.equal(validCommand({type:'showCompleted',pageId:'synthetic-page',listId:'synthetic-list'}),true);
  assert.equal(validCommand({type:'showCompleted'}),false);
  assert.equal(validCommand({type:'hideCompleted',pageId:'synthetic-page',listId:'synthetic-list'}),false);
});
