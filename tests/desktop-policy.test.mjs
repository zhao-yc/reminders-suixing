import test from 'node:test';
import assert from 'node:assert/strict';
import policy from '../apps/desktop/policy.cjs';

test('只允许 Apple 官方页面之间的会话存储权限', () => {
  assert.equal(policy.allowStorage('storage-access', 'https://idmsa.apple.com/', 'https://www.icloud.com.cn/'), true);
  assert.equal(policy.allowStorage('top-level-storage-access', 'https://www.icloud.com.cn/', 'https://www.icloud.com.cn/'), true);
  assert.equal(policy.allowStorage('storage-access', 'https://idmsa.apple.com.evil.example/', 'https://www.icloud.com.cn/'), false);
  assert.equal(policy.allowStorage('storage-access', 'https://idmsa.apple.com/', 'https://evil.example/'), false);
  for (const name of ['media', 'clipboard-read', 'fileSystem', 'geolocation']) assert.equal(policy.allowStorage(name, 'https://idmsa.apple.com/', 'https://www.icloud.com.cn/'), false);
});

test('浏览器兼容标识使用实际内核版本，不混入 Electron 产品令牌', () => {
  const ua = policy.browserUserAgent('155.0.0.0');
  assert.match(ua, /Chrome\/155\.0\.0\.0/);
  assert.doesNotMatch(ua, /Electron|suixing/i);
});

test('桌面桥接拒绝任意脚本和不明确的写入状态', () => {
  assert.equal(policy.validCommand({ type: 'eval', script: '任意脚本' }), false);
  assert.equal(policy.validCommand({ type: 'setCompleted', completed: 'true' }), false);
  assert.equal(policy.validCommand({ type: 'read' }), true);
});

test('桌面编辑只允许有前置指纹的标题和备注文字', () => {
  const command = { type: 'setText', pageId: 'synthetic-page', listId: 'synthetic-list', id: 'synthetic-id', fingerprint: 'synthetic-fingerprint', expectedCompleted: false, field: 'title', value: '随行验证 · 合成标题' };
  assert.equal(policy.validCommand(command), true);
  assert.equal(policy.validCommand({ ...command, field: 'notes', value: '' }), true);
  for (const change of [{ field: 'innerHTML' }, { value: '' }, { value: 'a\nb' }, { id: '' }, { value: 'a'.repeat(1001) }, { expectedCompleted: undefined }]) {
    assert.equal(policy.validCommand({ ...command, ...change }), false);
  }
});
