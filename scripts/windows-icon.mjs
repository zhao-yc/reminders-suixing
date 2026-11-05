import fs from 'node:fs/promises';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

export const windowsIconPath = new URL('../apps/desktop/assets/app.ico',import.meta.url);

async function readResources(file) {
  const exe = NtExecutable.from(await fs.readFile(file));
  const resource = NtExecutableResource.from(exe);
  const [group] = Resource.IconGroupEntry.fromEntries(resource.entries);
  if (!group) throw new Error('Windows 程序缺少图标资源组。');
  return {exe,resource,group};
}

async function sourceIcons() {
  const icon = Data.IconFile.from(await fs.readFile(windowsIconPath));
  return icon.icons;
}

/** 便携包沿用 Electron 的主图标资源标识，只替换该资源组中的图像。 */
export async function applyWindowsIcon(file) {
  const {exe,resource,group} = await readResources(file);
  const icons = await sourceIcons();
  Resource.IconGroupEntry.replaceIconsForResource(resource.entries,group.id,group.lang,icons.map(item => item.data));
  resource.outputResource(exe);
  await fs.writeFile(file,Buffer.from(exe.generate()));
}

/** 按帧核对主图标，防止安装器或程序悄悄退回默认资源。 */
export async function verifyWindowsIcon(file) {
  const {resource,group} = await readResources(file);
  const sizeKey = frame => frame.width+'x'+frame.height;
  const expected = new Map((await sourceIcons()).map(frame => [sizeKey(frame),Buffer.from(frame.data.generate())]));
  // NSIS 可按不同顺序保存各图像。使用图标组指定的资源编号和尺寸进行核对。
  for (const frame of group.icons) {
    const key = sizeKey(frame);
    const entry = resource.entries.find(item => item.type===3 && item.lang===group.lang && item.id===frame.iconID);
    if (!entry || !expected.get(key)?.equals(Buffer.from(entry.bin))) {
      throw new Error('Windows 程序主图标与随行资源不一致。');
    }
    expected.delete(key);
  }
  if (expected.size) throw new Error('Windows 程序主图标缺少随行资源尺寸。');
  return group.icons.length;
}
