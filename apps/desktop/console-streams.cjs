/** 控制台是可选诊断出口；启动终端退出或管道断开，不应让图形客户端弹出未处理异常并停住。 */
function protectConsoleStreams(streams = [process.stdout, process.stderr]) {
  const cleanup = [];
  for (const stream of streams) {
    if (!stream || typeof stream.on !== 'function') continue;
    const onError = () => {};
    stream.on('error', onError);
    cleanup.push(() => stream.removeListener('error', onError));
  }
  return () => cleanup.forEach(remove => remove());
}

module.exports = { protectConsoleStreams };
