import fs from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
// 固定几何图标，不使用截图或个人数据；PNG 生成后随桌面源码一起打包。
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,checksum]);}
const width=24,height=24,raw=Buffer.alloc(height*(width*4+1));
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let color=[0,0,0,0];
  if(x>=2 && x<=21 && y>=1 && y<=22 && !((x<4 || x>19) && (y<3 || y>20)))color=[255,255,255,255];
  for(const row of [6,12,18]){if((x-7)**2+(y-row)**2<=4)color=[22,135,255,255];if(x>=12 && x<=18 && Math.abs(y-row)<=1)color=[78,117,160,255];}
  const offset=y*(width*4+1)+1+x*4;raw.set(color,offset);
}
const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const target=new URL('../apps/desktop/assets/tray.png',import.meta.url);await fs.mkdir(new URL('.',target),{recursive:true});await fs.writeFile(target,png);process.stdout.write(fileURLToPath(target)+'\n');
