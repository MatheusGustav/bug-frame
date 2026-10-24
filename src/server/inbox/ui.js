import { LOCALES, resolveLocale, translator } from './i18n.js';

/** Changes only interface copy: request contents and unsaved fields stay untouched. */
export function languageUI(config) {
  const preferred = () => { try { return localStorage.getItem('bugframe:locale'); } catch { return null; } };
  const stored = preferred();
  const saved = stored && Object.hasOwn(LOCALES, stored) ? stored : null;
  const query = new URL(location.href).searchParams.get('lang');
  let locale = resolveLocale(query && Object.hasOwn(LOCALES, query) ? query : config.localePreference === 'auto' ? saved ?? config.locale : config.locale);
  let translate = translator(locale, config.labels);
  const ui = {
    get locale() { return locale; },
    t: (key, values) => translate(key, { name: config.siteName, ...values }),
    link(path) { const url = new URL(path, location.origin); url.searchParams.set('lang', locale); return url.pathname + url.search + url.hash; },
    render() {
      document.documentElement.lang = locale;
      for (const element of document.querySelectorAll('[data-i18n]')) {
        const value = ui.t(element.dataset.i18n);
        if (element.dataset.i18nAttr) element.setAttribute(element.dataset.i18nAttr, value); else element.textContent = value;
      }
      document.getElementById('language').value = locale;
    },
    start(onChange) {
      ui.render(); onChange();
      document.getElementById('language').addEventListener('change', event => {
        locale = resolveLocale(event.target.value); translate = translator(locale, config.labels);
        try { localStorage.setItem('bugframe:locale', locale); } catch { /* optional preference */ }
        const url = new URL(location.href); url.searchParams.set('lang', locale); history.replaceState(null, '', url.pathname + url.search + url.hash);
        ui.render(); onChange();
      });
    },
  };
  return ui;
}
