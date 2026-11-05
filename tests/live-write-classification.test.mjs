import test from 'node:test';
import assert from 'node:assert/strict';
import {isWriteTestCommand} from '../apps/desktop/live-check.cjs';

test('专用写入命令的信箱中断按不确定处理，取消和预检不冒充写入',()=>{
  for(const command of ['create-date-roundtrip-test-item','set-date-roundtrip-test-time','clear-date-roundtrip-test-time','delete-date-roundtrip-test-item'])assert.equal(isWriteTestCommand(command),true);
  assert.equal(isWriteTestCommand('read-date-roundtrip-test-item'),false);
  for(const command of ['create-date-transition-test-item','set-date-transition-test-day','set-date-transition-test-time','clear-date-transition-test-time','delete-date-transition-test-item'])assert.equal(isWriteTestCommand(command),true);
  for(const command of ['read-date-transition-test-item','set-date-transition-test-unknown'])assert.equal(isWriteTestCommand(command),false);
  for(const command of ['create-subtask-test-parent','create-subtask-test-child','indent-subtask-test-item','outdent-subtask-test-item','delete-subtask-test-child','delete-subtask-test-parent','create-appearance-test-list','set-appearance-test-style','restore-appearance-test-style','delete-appearance-test-list','delete-management-test-list','create-management-test-list','rename-management-test-list','restore-management-test-list','create-delete-test-item','delete-test-item','create-test-item','set-test-date','repair-original-test-date','create-sync-test-item','unflag-sync-test-item']) assert.equal(isWriteTestCommand(command),true);
  for(const command of ['clear-test-schedule','read-original-test-repair-state','read-subtask-test-state','cancel-subtask-test-indent','read-appearance-test-style','cancel-appearance-test-edit','select-appearance-test-list','cancel-delete-test-item','inspect-sync-delete','inspect-test-editor','read','select-test-list','quit','synthetic-unknown']) assert.equal(isWriteTestCommand(command),false);
});
