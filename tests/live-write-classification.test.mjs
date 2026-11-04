import test from 'node:test';
import assert from 'node:assert/strict';
import {isWriteTestCommand} from '../apps/desktop/live-check.cjs';

test('专用写入命令的信箱中断按不确定处理，取消和预检不冒充写入',()=>{
  for(const command of ['create-management-test-list','rename-management-test-list','restore-management-test-list','create-delete-test-item','delete-test-item','create-test-item','set-test-date','clear-test-schedule','create-sync-test-item','unflag-sync-test-item']) assert.equal(isWriteTestCommand(command),true);
  for(const command of ['cancel-delete-test-item','inspect-sync-delete','inspect-test-editor','read','select-test-list','quit','synthetic-unknown']) assert.equal(isWriteTestCommand(command),false);
});
