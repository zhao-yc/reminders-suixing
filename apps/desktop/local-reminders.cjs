const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createLocalFiles(directory, io = fs) {
  const filename = key => {
    if (typeof key !== 'string' || !/^(?:accounts|snapshot-(?:legacy-(?:cn|global)|[a-z0-9]{20,48}))$/.test(key)) throw Error('无效的快照名称');
    return path.join(directory, key + '.json');
  };
  return {
    read: key => io.readFile(filename(key), 'utf8'),
    async write(key, value) {
      if (typeof value !== 'string') throw Error('无效的快照内容');
      const target = filename(key);
      const temp = target + '.' + randomUUID() + '.tmp';
      await io.mkdir(directory, { recursive: true });
      try {
        const handle = await io.open(temp, 'wx', 0o600);
        try { await handle.writeFile(value, 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
        await io.rename(temp, target);
      } finally {
        await io.unlink(temp).catch(() => {});
      }
    },
    async remove(key) {
      await io.unlink(filename(key)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  };
}

module.exports = { createLocalFiles };
