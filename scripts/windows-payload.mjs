import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const forbidden=/(^|\/)(?:\.local|\.git|node_modules|tests|Partitions|Network|Local Storage|Session Storage|Cookies(?:-[^/]*)?|Login Data(?:-[^/]*)?|\.env(?:\.[^/]*)?|\.npmrc)(?:\/|$)|\.(?:keystore|jks|p12|pfx|pem|key|pass)$/i;
export function payloadPath(relative) {
  if(typeof relative!=='string' || !relative || relative.includes('\\') || relative.includes(':') || relative.startsWith('/') || relative.split('/').some(part=>!part || part==='.' || part==='..') || forbidden.test(relative))throw Error('载荷路径不合法或包含禁止分发的目录/文件。');
  return relative;
}

/** 先拒绝禁止路径和符号链接，再散列公开程序文件；不进入或读取任何会话目录。 */
export async function payloadManifest(directory) {
  const files=[];
  async function walk(relative='') {
    for(const entry of await fs.readdir(path.join(directory,relative),{withFileTypes:true})) {
      const name=payloadPath((relative?relative+'/':'')+entry.name);
      if(entry.isSymbolicLink())throw Error('载荷不能包含符号链接。');
      if(entry.isDirectory())await walk(name);
      else if(entry.isFile())files.push(name);
      else throw Error('载荷包含不支持的文件类型。');
    }
  }
  await walk();const manifest=[];
  for(const relative of files.sort()) {
    const content=await fs.readFile(path.join(directory,relative));
    manifest.push({path:relative,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')});
  }
  return manifest;
}

/** 安装产物中的关键代码必须与当前源文件和 HBuilderX 产物逐字一致。 */
export async function verifyCriticalFiles(root,directory) {
  const code=(await fs.readdir(path.join(root,'apps/desktop'))).filter(name=>name.endsWith('.cjs')).map(name=>'apps/desktop/'+name);
  const assets='apps/desktop/assets';
  if(await fs.stat(path.join(root,assets)).catch(()=>null))code.push(...(await payloadManifest(path.join(root,assets))).map(file=>assets+'/'+file.path));
  code.push('apps/uni-app/static/icloud/adapter.js');
  const frontend='apps/uni-app/unpackage/dist/build/web';
  const web=await payloadManifest(path.join(root,frontend));
  code.push(...web.map(file=>frontend+'/'+file.path));
  for(const relative of code) {
    const expected=await fs.readFile(path.join(root,relative)),actual=await fs.readFile(path.join(directory,'resources/app',relative));
    if(!expected.equals(actual))throw Error('安装载荷关键文件不匹配：'+relative);
  }
  return code.length;
}
