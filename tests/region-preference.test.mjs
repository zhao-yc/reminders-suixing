import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegionPreference, saveRegionPreference, REGION_PREFERENCE_KEY } from '../apps/uni-app/lib/region-preference.js';

test('新界面恢复上次区域，只访问固定的非账号设置键', () => {
  const values = new Map();
  const storage = {
    getStorageSync(key) { assert.equal(key, REGION_PREFERENCE_KEY); return values.get(key); },
    setStorageSync(key, value) { assert.equal(key, REGION_PREFERENCE_KEY); values.set(key, value); }
  };
  assert.equal(readRegionPreference(storage), 'cn');
  assert.equal(saveRegionPreference(storage, 'global'), true);
  assert.equal(readRegionPreference({ getStorageSync: key => values.get(key) }), 'global');
  assert.equal(saveRegionPreference(storage, 'cn'), true);
  assert.equal(readRegionPreference(storage), 'cn');
  assert.deepEqual([...values], [[REGION_PREFERENCE_KEY, 'cn']]);
});

test('损坏设置与任意地址不能变成区域，也不能写入存储', () => {
  for (const value of [undefined, null, {}, ['cn'], '__proto__', 'https://example.org/', 'GLOBAL', '']) {
    const storage = { getStorageSync: () => value, setStorageSync() { assert.fail('无效区域不得写入'); } };
    assert.equal(readRegionPreference(storage), 'cn');
    assert.equal(saveRegionPreference(storage, value), false);
  }
});

test('受限存储不阻止界面启动，也不声称区域已经保存', () => {
  const unavailable = { getStorageSync() { throw new Error('不可读'); }, setStorageSync() { throw new Error('不可写'); } };
  assert.equal(readRegionPreference(unavailable), 'cn');
  assert.equal(saveRegionPreference(unavailable, 'global'), false);
  assert.equal(saveRegionPreference({ getStorageSync: () => 'cn', setStorageSync() {} }, 'global'), false);
});
