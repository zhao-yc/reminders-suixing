import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { inspectFrame } = createRequire(import.meta.url)('../apps/desktop/page-diagnostics.cjs');

test('登录子页面永不响应时，诊断退出并且只派发一次读取', { timeout: 1000 }, async () => {
  let calls = 0;
  const state = await inspectFrame({ executeJavaScript() { calls++; return new Promise(() => {}); } }, 20);
  assert.equal(state, '子页面诊断超时');
  assert.equal(calls, 1);
});

test('诊断超时后的迟到失败不会成为未处理异常', async () => {
  let reject;
  const state = await inspectFrame({ executeJavaScript: () => new Promise((resolve, fail) => { reject = fail; }) }, 20);
  assert.equal(state, '子页面诊断超时');
  reject(new Error('合成子页面已经销毁'));
  await new Promise(resolve => setImmediate(resolve));
});

test('诊断失败不把底层异常内容带入日志或回执', async () => {
  const state = await inspectFrame({ executeJavaScript() { throw new Error('不应返回的合成异常详情'); } });
  assert.equal(state, '页面暂不可读取');
});
