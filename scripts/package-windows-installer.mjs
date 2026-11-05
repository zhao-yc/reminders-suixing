import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {payloadManifest,verifyCriticalFiles} from './windows-payload.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const {APP_ID,APP_NAME}=require('../apps/desktop/identity.cjs');
if(process.platform!=='win32')throw Error('安装包需在 Windows 环境构建。');
const {values}=parseArgs({options:{name:{type:'string'}}});
if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(values.name || '') || values.name.endsWith('.'))throw Error('请指定新的 ASCII 安装包目录名。');
const output=path.join(root,'outputs',values.name),payload=path.join(root,'outputs',values.name+'-payload');
await fs.mkdir(path.dirname(output),{recursive:true});await fs.mkdir(output,{recursive:false});
const metadata=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(metadata.version))throw Error('Windows 测试安装包需要明确的三段版本号。');
async function run(file,args,env=process.env) {
  await new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd:root,env,stdio:'inherit',windowsHide:true});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('构建进程失败：'+code)));
  });
}
await run(process.execPath,['scripts/package-windows.mjs','--name',values.name+'-payload']);
const before=await payloadManifest(payload);await verifyCriticalFiles(root,payload);
const processProbe=await fs.readFile(path.join(root,'build/windows/check-running.ps1'),'utf8');
const include=path.join(output,'installer.nsh');
await fs.writeFile(include,'!define SUIXING_PROCESS_PROBE "'+Buffer.from(processProbe,'utf16le').toString('base64')+'"\n'+await fs.readFile(path.join(root,'build/windows/installer.nsh'),'utf8'));
const config={appId:APP_ID,productName:APP_NAME,executableName:'提醒事项随行',electronVersion:require('electron/package.json').version,electronDist:path.dirname(require('electron')),asar:false,publish:null,npmRebuild:false,
  directories:{app:path.join(payload,'resources/app'),output,buildResources:path.join(root,'build/windows')},
  extraMetadata:{description:'提醒事项·随行 Windows 测试客户端',author:'提醒事项·随行贡献者'},
  extraFiles:[{from:path.join(root,'LICENSE'),to:'项目许可证.txt'},{from:path.join(payload,'使用说明.txt'),to:'使用说明.txt'}],
  win:{target:[{target:'nsis',arch:['x64']}],signExecutable:false,signAndEditExecutable:false},
  nsis:{oneClick:true,perMachine:false,runAfterFinish:false,createDesktopShortcut:false,createStartMenuShortcut:true,shortcutName:'提醒事项·随行',deleteAppDataOnUninstall:false,differentialPackage:false,packElevateHelper:false,installerLanguages:['zh_CN'],include,artifactName:'reminders-suixing-'+metadata.version+'-setup-x64.exe'}};
const configFile=path.join(output,'electron-builder.json');await fs.writeFile(configFile,JSON.stringify(config,null,2));
const env={...process.env,ELECTRON_BUILDER_CACHE:path.join(root,'.local/electron-builder-cache'),CSC_IDENTITY_AUTO_DISCOVERY:'false'};
for(const key of ['ELECTRON_RUN_AS_NODE','CSC_LINK','WIN_CSC_LINK','CSC_KEY_PASSWORD','WIN_CSC_KEY_PASSWORD','GH_TOKEN','GITHUB_TOKEN'])delete env[key];
await run(process.execPath,[require.resolve('electron-builder/cli.js'),'--config',configFile,'--win','nsis','--x64','--publish','never'],env);
if(JSON.stringify(before)!==JSON.stringify(await payloadManifest(payload)))throw Error('原始便携载荷在构建中发生变化。');
const unpacked=path.join(output,'win-unpacked'),manifest=await payloadManifest(unpacked),critical=await verifyCriticalFiles(root,unpacked);
await fs.writeFile(path.join(output,'payload-manifest.json'),JSON.stringify({version:metadata.version,criticalFiles:critical,files:manifest},null,2));
const installer=path.join(output,'reminders-suixing-'+metadata.version+'-setup-x64.exe'),content=await fs.readFile(installer);
const receipt={version:metadata.version,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex'),files:manifest.length,criticalFiles:critical,unsigned:true};
await fs.writeFile(path.join(output,'installer-receipt.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt));
