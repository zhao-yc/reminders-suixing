// #ifdef APP-PLUS
/** 将原生账号容器接到现有安卓网页桥接，复用登录、读写和汇总协议。 */
export function createProfileRuntime({openProfile, profileAction, forgetProfile}) {
  return {
    create(url, _viewId, _options, id) {
      const listeners = new Map();
      let currentURL = url;
      let visible = false;
      let override;
      const action = (type, value = '') => profileAction(id, type, value);
      const view = {
        addEventListener(type, listener) { listeners.set(type, listener); },
        overrideUrlLoading(_options, listener) { override = listener; },
        getURL: () => currentURL,
        isVisible: () => visible,
        show: () => action('show'),
        hide: () => action('hide'),
        close: () => action('close'),
        reload: () => action('reload'),
        loadURL: value => action('load', value),
        evalJS: value => action('evaluate', value)
      };
      openProfile(id, url, (type, value) => {
        if (type === 'reply') { override?.({url:value}); return; }
        if (type === 'loading' || type === 'loaded') currentURL = value;
        if (type === 'show' || type === 'hide' || type === 'close') visible = type === 'show';
        listeners.get(type)?.();
      });
      return view;
    },
    forget: id => new Promise(resolve => forgetProfile(id, resolve))
  };
}
// #endif
