import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32') throw new Error('便携包需在 Windows 环境生成。');
const destination = path.join(root, 'outputs', 'windows-portable');
// 使用新目录生成，避免覆盖正在运行的客户端和会话文件。
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.mkdir(destination, { recursive: false });
await fs.cp(path.dirname(require('electron')), destination, { recursive: true });
await fs.rename(path.join(destination, 'electron.exe'), path.join(destination, '提醒事项随行.exe'));
const appRoot = path.join(destination, 'resources', 'app');
await fs.mkdir(appRoot, { recursive: true });
await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'reminders-suixing', version: '0.1.0', main: 'apps/desktop/main.cjs' }, null, 2));
for (const relative of ['apps/desktop', 'apps/uni-app/static/icloud']) {
  await fs.cp(path.join(root, relative), path.join(appRoot, relative), { recursive: true });
}
let found = false;
for (const platform of ['web', 'h5']) {
  const relative = 'apps/uni-app/unpackage/dist/build/' + platform;
  if (await fs.stat(path.join(root, relative, 'index.html')).catch(() => null)) {
    await fs.cp(path.join(root, relative), path.join(appRoot, relative), { recursive: true });
    found = true;
    break;
  }
}
if (!found) throw new Error('没有找到 HBuilderX Web 发布产物。');
await fs.copyFile(path.join(root, 'LICENSE'), path.join(destination, '项目许可证.txt'));
await fs.writeFile(path.join(destination, '使用说明.txt'), '提醒事项·随行 0.1.0 最小验证版\r\n运行“提醒事项随行.exe”，在 iCloud 官方页面自行登录，返回主界面刷新。\r\n尚未签名；不包含任何登录会话或个人数据。\r\n');
console.log('已生成 Windows 便携包：' + destination);
