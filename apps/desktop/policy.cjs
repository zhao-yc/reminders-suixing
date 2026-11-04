/** 只允许官方 HTTPS 域名，不放行相似域名或本地协议。 */
function allowedURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (!url.port || url.port === '443') &&
      ['icloud.com', 'icloud.com.cn', 'apple.com', 'apple.com.cn'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch { return false; }
}

/** 官方跨站登录需要 Cookie 存储；该许可只限 Apple 页面之间，不开放相机、剪贴板或文件权限。 */
function allowStorage(permission, requestingURL, embeddingURL) {
  return ['storage-access', 'top-level-storage-access'].includes(permission) && allowedURL(requestingURL) && allowedURL(embeddingURL);
}

/** 报告实际 Chromium 内核版本，去除站点不认识的 Electron／应用产品标识。 */
function browserUserAgent(chromiumVersion) {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chromiumVersion + ' Safari/537.36';
}

function validCommand(command) {
  if (!command || typeof command !== 'object' || !['read', 'selectList', 'setCompleted', 'setText'].includes(command.type)) return false;
  if (command.type === 'read') return true;
  if (typeof command.pageId !== 'string' || command.pageId.length > 150 || typeof command.listId !== 'string' || command.listId.length > 150) return false;
  if (command.type === 'selectList') return true;
  const target = typeof command.id === 'string' && command.id.length > 0 && command.id.length <= 1024 && typeof command.fingerprint === 'string' &&
    command.fingerprint.length <= 16000 && typeof command.expectedCompleted === 'boolean';
  if (command.type === 'setText') return target && ['title', 'notes'].includes(command.field) && typeof command.value === 'string' &&
    command.value.length <= (command.field === 'title' ? 1000 : 2000) && (command.field !== 'title' || (command.value.trim().length > 0 && !/[\r\n]/.test(command.value)));
  return target && typeof command.completed === 'boolean';
}

module.exports = { allowedURL, allowStorage, browserUserAgent, validCommand };
