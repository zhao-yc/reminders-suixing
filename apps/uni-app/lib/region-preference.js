// 与账号会话分开，只保存固定区域代码，不接受地址、账号或网页数据。
export const REGION_PREFERENCE_KEY = 'suixing.settings.region';
const validRegion = value => value === 'cn' || value === 'global';

export function readRegionPreference(storage) {
  try {
    const value = storage.getStorageSync(REGION_PREFERENCE_KEY);
    return validRegion(value) ? value : 'cn';
  } catch { return 'cn'; }
}

export function saveRegionPreference(storage, region) {
  if (!validRegion(region)) return false;
  try {
    storage.setStorageSync(REGION_PREFERENCE_KEY, region);
    return storage.getStorageSync(REGION_PREFERENCE_KEY) === region;
  } catch { return false; }
}
