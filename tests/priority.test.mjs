import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {priorityInfo} from '../apps/uni-app/lib/priority.js';
import {validCommand} from '../apps/desktop/policy.cjs';

const source=await fs.readFile(new URL('../apps/uni-app/static/icloud/adapter.js',import.meta.url),'utf8');
const fixture=await fs.readFile(new URL('./fixtures/reminders.html',import.meta.url),'utf8');
async function setup(t) {
  const dom=new JSDOM(fixture,{url:'https://www.icloud.com.cn/reminders/',runScripts:'dangerously'});
  t.after(()=>dom.window.close());dom.window.eval(source);
  const execute=command=>dom.window.__suixingAdapter.execute(command),snapshot=(await execute({type:'read'})).snapshot;
  const row=dom.window.document.getElementById(snapshot.items[1].id);
  return {window:dom.window,execute,snapshot,row,cell:row.querySelector('.title').previousElementSibling};
}

test('只读取已加载优先级图标和明确空格，不打开详情、不保存或调用私有模型',async t=>{
  const {window,execute,row,cell}=await setup(t);
  const key=Object.getOwnPropertyNames(row).find(key=>key.startsWith('__reactProps$'));
  const record=row[key].children.props.item;
  row[key].children.props.item=new Proxy(record,{get(record,name){assert.ok(['pk','DueDate','AllDay','TimeZone'].includes(name));return record[name];},ownKeys(){assert.fail('不得枚举网页记录');}});
  for(const [html,priority] of [['','none'],['<span class="priority" data-priority-level="9">!</span>','low'],['<span class="priority" data-priority-level="5">!!</span>','medium'],['<span class="priority" data-priority-level="1">!!!</span>','high']]) {
    cell.innerHTML=html;
    assert.equal((await execute({type:'read'})).snapshot.items[1].priority,priority);
  }
  assert.equal(window.document.querySelector('.details-popover'),null);
  assert.equal(window.fixtureClicks,0);assert.equal(window.fixtureScheduleSaveClicks,0);assert.equal(window.fixtureFlagToggleClicks,0);
});

test('优先级格不明确、未知标记和多个图标均不可读，不当作无优先级',async t=>{
  const {execute,cell}=await setup(t);
  for(const html of ['未知文字','<span class="priority" data-priority-level="0"></span>','<span class="priority" data-priority-level="2"></span>','<div class="priority" data-priority-level="1"></div>','<span class="priority" data-priority-level="1"></span><span></span>','<span><span class="priority" data-priority-level="1"></span></span>']) {
    cell.innerHTML=html;assert.equal((await execute({type:'read'})).snapshot.items[1].priority,null);
  }
  cell.innerHTML='';cell.removeAttribute('role');assert.equal((await execute({type:'read'})).snapshot.items[1].priority,null);
});

test('优先级从高变低或变未知后，旧完成与文字编辑均拒绝，不点击事项',async t=>{
  const {window,execute,snapshot,cell}=await setup(t);const item=snapshot.items[1];
  cell.firstElementChild.setAttribute('data-priority-level','9');
  const base={pageId:snapshot.pageId,listId:item.listId,id:item.id,fingerprint:item.fingerprint,expectedCompleted:item.completed};
  assert.equal((await execute({...base,type:'setCompleted',completed:true})).code,'STALE_VIEW');
  assert.equal((await execute({...base,type:'setText',field:'title',value:'随行验证 · 不应保存'})).code,'STALE_VIEW');
  const current=(await execute({type:'read'})).snapshot.items[1];
  cell.firstElementChild.setAttribute('data-priority-level','2');
  assert.equal((await execute({...base,fingerprint:current.fingerprint,type:'setFlagged',expectedFlagged:false,flagged:true})).code,'STALE_VIEW');
  assert.equal(window.fixtureClicks,0);assert.equal(window.fixtureTextSaves,0);assert.equal(window.fixtureFlagToggleClicks,0);
});

test('只读优先级不开放伪造写命令，固定显示枚举不会包含未知原文',async t=>{
  const {execute}=await setup(t);
  assert.equal((await execute({type:'setPriority',priority:'high'})).code,'INVALID_COMMAND');
  assert.equal(validCommand({type:'setPriority',priority:'high'}),false);
  assert.equal(priorityInfo('high').mark,'!!!');assert.equal(priorityInfo('medium').mark,'!!');assert.equal(priorityInfo('low').mark,'!');assert.equal(priorityInfo('none').rank,0);
  for(const value of [null,undefined,'synthetic-private-text','toString']) {
    assert.equal(priorityInfo(value).rank,null);assert.equal(priorityInfo(value).label,'优先级不可读');
    assert.doesNotMatch(JSON.stringify(priorityInfo(value)),/synthetic-private/);
  }
});
