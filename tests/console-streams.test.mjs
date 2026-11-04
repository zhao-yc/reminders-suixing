import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('启动端关闭真实 stdout/stderr 管道后，图形客户端的日志不会终止进程', { timeout: 6000 }, async t => {
  const helper = new URL('../apps/desktop/console-streams.cjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import helper from ${JSON.stringify(helper)};
    helper.protectConsoleStreams();
    process.on('message', message => {
      if (message === 'write') {
        console.log('合成日志'.repeat(20000));
        console.error('合成错误日志'.repeat(20000));
        setTimeout(() => process.send('alive'), 100);
      } else if (message === 'quit') process.disconnect();
    });
    process.send('ready');
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  assert.equal((await once(child, 'message'))[0], 'ready');
  const outputsClosed = Promise.all([once(child.stdout, 'close'), once(child.stderr, 'close')]);
  child.stdout.destroy();
  child.stderr.destroy();
  await outputsClosed;
  const alive = new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('exit', code => reject(new Error('日志写入导致进程提前结束：' + code)));
  });
  child.send('write');
  assert.equal(await alive, 'alive');
  const exited = once(child, 'exit');
  child.send('quit');
  assert.equal((await exited)[0], 0);
});
