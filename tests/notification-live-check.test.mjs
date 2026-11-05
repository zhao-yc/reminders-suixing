import assert from 'node:assert/strict';
import test from 'node:test';
import {isWriteTestCommand} from '../apps/desktop/live-check.cjs';
import {createNotificationLiveCheck} from '../apps/desktop/notification-live-check.cjs';

const baseList = {id:'base', title:'随行验证（2026-11-04）'};
const testList = {id:'notification', title:'随行验证 · Windows 通知实测'};

test('通知实测的云端写入命令按可能已提交处理', () => {
  for (const action of ['create-notification-test-list', 'create-notification-test-item', 'schedule-notification-test-item',
    'delete-notification-test-item', 'delete-notification-test-list']) assert.equal(isWriteTestCommand(action), true);
  for (const action of ['read-notification-test', 'check-notification-test-readiness', 'arm-notification-test', 'poll-notification-test', 'stop-notification-test'])
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
