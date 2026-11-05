import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// 使用真实 Electron 内核验证合成页面与构建界面，数据目录与个人会话严格分开。
const child = spawn(require('electron'), [path.join(root, 'apps/desktop/main.cjs'), '--smoke-test', ...(process.argv.includes('--auto-read') ? ['--smoke-auto-read'] : [])], { cwd: root, env, stdio: 'inherit', windowsHide: true });
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; }, process.argv.includes('--auto-read') ? 90000 : 55000);
child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1; });
child.on('error', error => { clearTimeout(timeout); console.error('无法启动桌面验证：' + error.message); process.exitCode = 1; });
