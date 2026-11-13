/** 固定服务入口，调用方只传区域代码，禁止传入任意网页地址。 */
export const REGIONS = {
  cn: { label: '中国大陆', url: 'https://www.icloud.com.cn/reminders/' },
  global: { label: '其他地区', url: 'https://www.icloud.com/reminders/' }
};

/** uni-app 的原生逻辑层可能没有 URL。只识别 HTTPS 官方域名和默认端口。 */
export function applePageHost(value) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  const match = /^https:\/\/((?:[a-z0-9-]+\.)*(?:icloud\.com(?:\.cn)?|apple\.com(?:\.cn)?))(?::443)?(?:[/?#]|$)/i.exec(value);
  return match ? match[1].toLowerCase() : null;
}

export function isApplePage(value) {
  return applePageHost(value) !== null;
}
