import assert from 'node:assert/strict';
import test from 'node:test';
import {isWriteTestCommand} from '../apps/desktop/live-check.cjs';
import {createNotificationLiveCheck} from '../apps/desktop/notification-live-check.cjs';

const baseList = {id:'base', title:'随行验证（2026-11-04）'};
const testList = {id:'notification', title:'随行验证 · Windows 通知实测'};

test('通知实测的云端写入命令按可能已提交处理', () => {
  for (const action of ['create-notification-test-list', 'create-notification-test-item', 'schedule-notification-test-item',
    'reschedule-notification-test-item', 'delete-notification-test-item', 'delete-notification-test-list']) assert.equal(isWriteTestCommand(action), true);
  for (const action of ['read-notification-test', 'check-notification-test-readiness', 'check-notification-test-cleanup',
    'verify-notification-test-date-sections', 'arm-notification-test',
    'poll-notification-test', 'stop-notification-test'])
    assert.equal(isWriteTestCommand(action), false);
});

test('已有同名清单时不重建，专用清单出现其他事项时不提交删除', async () => {
  const calls = [];
  const controller = {async execute(command) {
    calls.push(command);
    if (command.type === 'readLists') return {ok:true, snapshot:{pageId:'page', lists:[baseList, testList]}};
    return {ok:true, snapshot:{pageId:'page', activeListId:testList.id, items:[{title:'合成范围外事项'}]}};
  }};
  const clicks = [];
  const ui = {webContents:{async executeJavaScript(script) {
    clicks.push(script);
    assert.match(script, /^\(async function selectTestListClient\(/);
    return true;
  }}};
  const scenario = createNotificationLiveCheck({controller, ui, sendSnapshot:()=>{}});
  assert.equal((await scenario.run('create-notification-test-list')).code, 'TEST_NOTIFICATION_SCOPE_REQUIRED');
  assert.deepEqual(calls.map(call => call.type), ['readLists']);
  assert.equal(clicks.length, 0);
  assert.equal((await scenario.run('delete-notification-test-list')).code, 'TEST_NOTIFICATION_SCOPE_REQUIRED');
  assert.deepEqual(calls.at(-1), {type:'readList', pageId:'page', listId:testList.id});
  assert.equal(clicks.length, 1);
});

test('保留事项的日期已变化时不打开日期编辑器', async () => {
  const reads = [];
  const controller = {async execute(command) {
    reads.push(command.type);
    if (command.type === 'readLists') return {ok:true, snapshot:{pageId:'page', lists:[testList]}};
    return {ok:true, snapshot:{pageId:'page', activeListId:testList.id, items:[{
      id:'item', title:'随行验证 · Windows 到期通知实测', completed:false, flagged:false, level:1,
      schedule:{date:'2026-11-05', time:'14:06', timeZone:'Asia/Shanghai'}
    }]}};
  }};
  const ui = {webContents:{async executeJavaScript(script) {
    assert.match(script, /^\(async function selectTestListClient\(/);
    return true;
  }}};
  const scenario = createNotificationLiveCheck({controller, ui, sendSnapshot:()=>{}});
  const result = await scenario.run('reschedule-notification-test-item');
  assert.equal(result.code, 'TEST_NOTIFICATION_SCHEDULE_CHANGED');
  assert.deepEqual(reads, ['readLists', 'readList']);
});
