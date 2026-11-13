import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalStore, createAccountRefresh, refreshOfficial, toLocalReport, matchingList } from '../apps/uni-app/lib/local-reminders.mjs';
import { projectAcrossLists } from '../apps/uni-app/lib/list-views.js';
import filesModule from '../apps/desktop/local-reminders.cjs';

const first = {id:'legacy-cn',region:'cn',label:'iCloud',confirmed:true};
const second = {id:'secondsyntheticaccount123',region:'cn',label:'iCloud 2',confirmed:true};
const summary = (title, partial = false) => ({
  capturedAt:'2026-11-13T14:00:00Z', totalLists:partial?2:1,
  lists:[{list:{id:'page-list',title:'随行验证 · 同名清单',color:'#1687ff',fingerprint:'list-secret'},partial,
    items:[{id:'page-row',title,completed:false,flagged:false,fingerprint:'write-secret',scheduleFingerprint:'date-secret'},
      {id:'completed-row',title:'随行验证 · 已完成',completed:true}]}]
});

test('离线冷启动能从磁盘恢复两个账号，同名清单和事项的标识隔离', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'suixing-local-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const files = filesModule.createLocalFiles(directory);
  const store = createLocalStore(files);
  await store.saveAccounts([first,second]);
  await store.saveReport(first,toLocalReport(first,summary('随行验证 · 账号一')));
  await store.saveReport(second,toLocalReport(second,summary('随行验证 · 账号二')));
  const restarted = createLocalStore(filesModule.createLocalFiles(directory));
  const accounts = await restarted.accounts();
  const snapshots = await Promise.all(accounts.map(account=>restarted.report(account)));
  const projection = projectAcrossLists(snapshots.flatMap(value=>value.lists),{view:'pending'});
  assert.equal(projection.counts.pending,2);
  assert.equal(projection.counts.completed,2);
  assert.equal(new Set(projection.rows.map(row=>row.key)).size,2);
  assert.equal(matchingList(snapshots.map(report=>report.lists[0].list),snapshots[0].lists[0].list),null);
  assert.doesNotMatch(await files.read('snapshot-legacy-cn'),/secret|page-row|page-list/);
  await restarted.removeReport(first);
  assert.equal(await restarted.report(first),null);
  assert.ok(await restarted.report(second));
});

test('原子替换中断时仍可读到上次快照', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'suixing-atomic-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const original = filesModule.createLocalFiles(directory);
  await original.write('accounts','旧快照');
  const interrupted = filesModule.createLocalFiles(directory,{...fs,rename:async()=>{throw Error('合成中断');}});
  await assert.rejects(interrupted.write('accounts','新快照'),/合成中断/);
  assert.equal(await original.read('accounts'),'旧快照');
  assert.deepEqual(await fs.readdir(directory),['accounts.json']);
});

test('冷启动只汇总一次，重叠的手动刷新共用任务，一个账号失败时另一个继续', async () => {
  const reports = new Map([[first.id,toLocalReport(first,summary('随行验证 · 原快照'))]]);
  const reads = [], codes = [];
  let initial = true;
  let unblock;
  const gate = new Promise(resolve=>{unblock=resolve;});
  const refresh = createAccountRefresh({
    collect:async account=>{
      reads.push(account.id);
      if (account===first) {
        await gate;
        return initial ? {ok:true,summary:summary('随行验证 · 部分读取',true)} : {ok:false,code:'LOGIN_REQUIRED'};
      }
      return {ok:true,summary:summary('随行验证 · 账号二')};
    },
    previous:account=>reports.get(account.id),
    active:()=>true,
    save:async()=>{},
    update:(account,report,code)=>{codes.push(code);if(report)reports.set(account.id,report);}
  });
  const startup = refresh.start([first,second]);
  assert.equal(refresh.refresh([first,second]),startup);
  unblock();
  await startup;
  assert.equal(refresh.start([first,second]),null);
  assert.deepEqual(reads,[first.id,second.id]);
  assert.deepEqual(codes,['PARTIAL','READY']);
  initial=false;
  await refresh.refresh([first,second]);
  assert.deepEqual(codes,['PARTIAL','READY','LOGIN_REQUIRED','READY']);
  assert.equal(reports.get(first.id).lists[0].items[0].title,'随行验证 · 原快照');
});

test('刚完成登录时复用同一账号的官方页面，手动刷新先打开后台页', async () => {
  const calls=[];
  const navigation={ok:true,snapshot:{pageId:'synthetic-page',lists:[{}]}};
  const bridge={
    prepareSummary:async (...args)=>{calls.push(['open',...args]);return {ok:true};},
    readNavigation:async (...args)=>{calls.push(['read',...args]);return navigation;},
    readSummary:async (...args)=>{calls.push(['summary',...args]);return {ok:true,summary:summary('随行验证 · 已读取')};}
  };
  assert.ok((await refreshOfficial(bridge,second,navigation)).ok);
  assert.deepEqual(calls,[['summary','synthetic-page','','cn',second.id]]);
  calls.length=0;
  assert.ok((await refreshOfficial(bridge,first)).ok);
  assert.deepEqual(calls,[['open','cn',first.id],['read','cn',first.id],['summary','synthetic-page','','cn',first.id]]);
});
