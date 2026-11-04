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
