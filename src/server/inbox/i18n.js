// Shared by server-rendered pages and browser UI. Contains no project or account data.
import en from './strings-en.js';
import es from './strings-es.js';
import pt from './strings-pt.js';

export const LOCALES = { en, es, pt };

export function resolveLocale(value = 'auto', acceptLanguage = '') {
  const supported = code => typeof code === 'string' && Object.hasOwn(LOCALES, code.toLowerCase().split('-')[0]) ? code.toLowerCase().split('-')[0] : null;
  if (value !== 'auto') return supported(value) ?? 'en';
  const preferences = acceptLanguage.split(',').map(part => {
    const [language, ...parameters] = part.trim().split(';');
    const quality = parameters.find(value => value.trim().startsWith('q='));
    return { language, q: quality ? Number(quality.trim().slice(2)) : 1 };
  }).filter(value => value.q > 0 && value.q <= 1).sort((a, b) => b.q - a.q);
  return preferences.map(value => supported(value.language)).find(Boolean) ?? 'en';
}
export function translator(locale, overrides = {}) {
  const strings = LOCALES[resolveLocale(locale)];
  return (key, values = {}) => (overrides[key] ?? strings[key] ?? LOCALES.en[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
}
