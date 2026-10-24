import { describe, expect, it } from 'vitest';
import { LOCALES, resolveStrings } from '../../src/widget/i18n';

describe('i18n', () => {
  it('every locale has every key', () => { const keys = Object.keys(LOCALES.en).sort(); for (const [code, s] of Object.entries(LOCALES)) expect(Object.keys(s).sort(), code).toEqual(keys); });
  it('picks a locale, falls back to the base language and to English', () => {
    expect(resolveStrings('pt', {}).send).toBe('Enviar feedback'); expect(resolveStrings('es-MX', {}).send).toBe('Enviar comentario'); expect(resolveStrings('xx', {}).send).toBe('Send feedback');
  });
  it('overrides win', () => { expect(resolveStrings('en', { send: 'Ship it' }).send).toBe('Ship it'); expect(resolveStrings('en', { send: 'Ship it' }).cancel).toBe('Cancel'); });
});

it('auto follows an explicit page language or the saved portal choice, while explicit widget locale wins', () => {
  try {
    localStorage.setItem('bugframe:locale', 'pt');
    history.replaceState(null, '', '/'); expect(resolveStrings('auto', {}).send).toBe('Enviar feedback');
    history.replaceState(null, '', '/?lang=es'); expect(resolveStrings('auto', {}).send).toBe('Enviar comentario');
    expect(resolveStrings('en', {}).send).toBe('Send feedback');
    localStorage.setItem('bugframe:locale', 'invalid'); history.replaceState(null, '', '/'); expect(resolveStrings('auto', {}).send).toBe('Send feedback');
  } finally { localStorage.removeItem('bugframe:locale'); history.replaceState(null, '', '/'); }
});
