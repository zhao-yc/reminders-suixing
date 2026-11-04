import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { inspectFrame, diagnosticRoute, publicExceptionFrames } = createRequire(import.meta.url)('../apps/desktop/page-diagnostics.cjs');

test('异常位置只保留公开脚本行列，忽略正文、对象、变量及私人地址', () => {
  const result = publicExceptionFrames({text:'synthetic-private-message',exception:{description:'synthetic-private-value'},stackTrace:{callFrames:[
    {url:'https://www.icloud.com.cn/applications/reminders2/build/zh-cn/main.js?token=synthetic-token',lineNumber:0,columnNumber:99,functionName:'synthetic-private-name',scopeChain:['synthetic-private-value']},
    {url:'https://gatewayws.icloud.com/accounts/synthetic-account',lineNumber:0,columnNumber:1}
  ]}});
  assert.deepEqual(result,[{source:'https://www.icloud.com.cn/applications/reminders2/build/zh-cn/main.js',line:1,column:100}]);
  assert.doesNotMatch(JSON.stringify(result),/synthetic/);
});

test('服务请求诊断省略整个路径及查询，静态脚本只保留公开路径', () => {
  assert.equal(diagnosticRoute('https://gatewayws.icloud.com/acsegateway/v1/accounts/synthetic-account/plans?token=synthetic-token'), 'https://gatewayws.icloud.com/<服务路径已省略>');
  assert.equal(diagnosticRoute('https://www.icloud.com/applications/reminders2/build/zh-cn/main.js?token=synthetic-token'), 'https://www.icloud.com/applications/reminders2/build/zh-cn/main.js');
  assert.equal(diagnosticRoute('https://www.icloud.com/reminders/'), 'https://www.icloud.com/reminders/');
  assert.equal(diagnosticRoute('about:blank'), 'about:');
});

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
