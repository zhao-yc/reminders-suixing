import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require=createRequire(import.meta.url),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(root,'apps/desktop/main.cjs'),'--verify-notifications'],{cwd:root,env,windowsHide:true,stdio:'inherit'});
const timer=setTimeout(()=>{child.kill();process.exitCode=1;},60000);
child.on('exit',code=>{clearTimeout(timer);process.exitCode=code??1;});child.on('error',()=>{clearTimeout(timer);process.exitCode=1;});
