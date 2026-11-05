import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {payloadPath,payloadManifest} from '../scripts/windows-payload.mjs';

test('安装载荷拒绝越界路径、会话、凭据和测试目录，允许正常中文程序文件',()=>{
  for(const file of ['../private','C:/private','/private','a\\b','a//b','a/../b','.local/anything','resources/app/.env','resources/app/.npmrc','Network/Cookies','Cookies','Partitions/one','a/Login Data','a/key.pfx','a/key.jks','a/private.pem','node_modules/anything','tests/private'])assert.throws(()=>payloadPath(file));
  assert.equal(payloadPath('提醒事项随行.exe'),'提醒事项随行.exe');assert.equal(payloadPath('resources/app/apps/desktop/main.cjs'),'resources/app/apps/desktop/main.cjs');
});
test('载荷清单散列真实文件并检测变化，禁止目录出现时在读取其内容前停止',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'suixing-payload-'));t.after(async()=>{const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('suixing-payload-'));await fs.rm(target,{recursive:true,force:true});});
  await fs.writeFile(path.join(directory,'公开程序.txt'),'合成程序内容');const first=await payloadManifest(directory);
  assert.equal(first.length,1);assert.equal(first[0].sha256.length,64);
  await fs.writeFile(path.join(directory,'公开程序.txt'),'合成修改');assert.notEqual((await payloadManifest(directory))[0].sha256,first[0].sha256);
  await fs.mkdir(path.join(directory,'.local'));await fs.writeFile(path.join(directory,'.local','不可读取.txt'),'合成敏感内容');
  let reads=0;t.mock.method(fs,'readFile',async()=>{reads++;assert.fail('不能在禁止路径检查完成前散列文件');});
  await assert.rejects(payloadManifest(directory),/禁止分发/);
  assert.equal(reads,0);
});
