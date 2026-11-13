import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { applyWindowsIcon, verifyWindowsIcon } from './windows-icon.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if (process.platform !== 'win32') throw new Error('便携包需在 Windows 环境生成。');
const { values } = parseArgs({ options: { name: { type: 'string', default: 'windows-portable' } } });
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(values.name)) throw new Error('包目录名只能使用字母、数字、点、下划线或短横线。');
const destination = path.join(root, 'outputs', values.name);
let frontend;
for (const platform of ['web', 'h5']) {
  const relative = 'apps/uni-app/unpackage/dist/build/' + platform;
  if (await fs.stat(path.join(root, relative, 'index.html')).catch(() => null)) { frontend = relative; break; }
}
if (!frontend) throw new Error('没有找到 HBuilderX Web 发布产物。');
// 使用新目录生成，避免覆盖正在运行的客户端和会话文件。
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.mkdir(destination, { recursive: false });
await fs.cp(path.dirname(require('electron')), destination, { recursive: true });
const executable = path.join(destination, '提醒事项随行.exe');
await fs.rename(path.join(destination, 'electron.exe'), executable);
await applyWindowsIcon(executable);
await verifyWindowsIcon(executable);
const appRoot = path.join(destination, 'resources', 'app');
await fs.mkdir(appRoot, { recursive: true });
await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'reminders-suixing', version: metadata.version, main: 'apps/desktop/main.cjs' }, null, 2));
for (const relative of ['apps/desktop', 'apps/uni-app/static/icloud', 'apps/uni-app/lib/collect-summary.mjs']) {
  await fs.cp(path.join(root, relative), path.join(appRoot, relative), { recursive: true });
}
await fs.cp(path.join(root, frontend), path.join(appRoot, frontend), { recursive: true });
await fs.copyFile(path.join(root, 'LICENSE'), path.join(destination, '项目许可证.txt'));
await fs.writeFile(path.join(destination, '使用说明.txt'), '提醒事项·随行 '+metadata.version+' 最小验证版\r\n运行“提醒事项随行.exe”，在 iCloud 官方页面自行登录。清单就绪后自动返回主界面并读取汇总。\r\n尚未签名；不包含任何登录会话或个人数据。\r\n');
console.log('已生成 Windows 便携包：' + destination);
