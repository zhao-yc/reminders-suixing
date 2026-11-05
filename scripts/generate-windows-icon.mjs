import fs from 'node:fs/promises';

const sizes = [16, 24, 32, 48, 64, 128, 256];
const dots = [
  {y:9, color:[22, 135, 255]},
  {y:16, color:[238, 149, 96]},
  {y:23, color:[178, 139, 214]}
];

function insideRoundedRect(x,y,left,top,right,bottom,radius) {
  const dx = x-Math.max(left+radius, Math.min(x,right-radius));
  const dy = y-Math.max(top+radius, Math.min(y,bottom-radius));
  return dx*dx+dy*dy <= radius*radius;
}

// 复用客户端品牌的白色清单与三色圆点。浅蓝边缘便于在浅色背景中辨识。
function colorAt(x,y) {
  if (!insideRoundedRect(x,y,2,2,30,30,7)) return null;
  if (!insideRoundedRect(x,y,3,3,29,29,6)) return [169,199,234];
  for (const dot of dots) {
    if ((x-10)**2+(y-dot.y)**2 <= 2.25**2) return dot.color;
    if (insideRoundedRect(x,y,15,dot.y-0.9,24,dot.y+0.9,0.9)) return [117,134,157];
  }
  return [255,255,255];
}

function iconBitmap(size) {
  const maskStride = Math.ceil(size/32)*4;
  const maskStart = 40+size*size*4;
  const bitmap = Buffer.alloc(maskStart+size*maskStride);
  bitmap.writeUInt32LE(40,0);
  bitmap.writeInt32LE(size,4);
  bitmap.writeInt32LE(size*2,8);
  bitmap.writeUInt16LE(1,12);
  bitmap.writeUInt16LE(32,14);
  for (let y=0; y<size; y++) {
    for (let x=0; x<size; x++) {
      let red=0, green=0, blue=0, hits=0;
      for (let sy=0; sy<4; sy++) {
        for (let sx=0; sx<4; sx++) {
          const color = colorAt((x+(sx+0.5)/4)*32/size,(y+(sy+0.5)/4)*32/size);
          if (!color) continue;
          red+=color[0]; green+=color[1]; blue+=color[2]; hits++;
        }
      }
      const row = size-1-y;
      if (!hits) {
        bitmap[maskStart+row*maskStride+Math.floor(x/8)] |= 0x80 >>> (x%8);
        continue;
      }
      const offset = 40+(row*size+x)*4;
      bitmap.set([Math.round(blue/hits),Math.round(green/hits),Math.round(red/hits),Math.round(hits*255/16)],offset);
    }
  }
  return bitmap;
}

const directory = Buffer.alloc(6+sizes.length*16);
directory.writeUInt16LE(1,2);
directory.writeUInt16LE(sizes.length,4);
let offset = directory.length;
const bitmaps = sizes.map((size,index) => {
  const bitmap = iconBitmap(size);
  const entry = 6+index*16;
  directory[entry] = directory[entry+1] = size%256;
  directory.writeUInt16LE(1,entry+4);
  directory.writeUInt16LE(32,entry+6);
  directory.writeUInt32LE(bitmap.length,entry+8);
  directory.writeUInt32LE(offset,entry+12);
  offset += bitmap.length;
  return bitmap;
});

await fs.writeFile(new URL('../apps/desktop/assets/app.ico',import.meta.url),Buffer.concat([directory,...bitmaps]));
