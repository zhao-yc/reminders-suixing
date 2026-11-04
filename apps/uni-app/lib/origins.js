/** 固定服务入口，调用方只传区域代码，禁止传入任意网页地址。 */
export const REGIONS = {
  cn: { label: '中国大陆', url: 'https://www.icloud.com.cn/reminders/' },
  global: { label: '其他地区', url: 'https://www.icloud.com/reminders/' }
};

/** 按域名边界检查官方页面，避免 icloud.com.example.org 一类伪装域名。 */
export function isApplePage(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return false;
    return ['icloud.com', 'icloud.com.cn', 'apple.com', 'apple.com.cn'].some(
      host => url.hostname === host || url.hostname.endsWith('.' + host)
    );
  } catch {
    return false;
  }
}
