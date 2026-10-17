import { beforeEach, describe, expect, it } from 'vitest';
import { maskRects, selectorList } from '../../src/widget/capture';
import { reset } from './helpers';

const box = (el: Element, x: number, y: number, w: number, h: number) => { (el as HTMLElement).getBoundingClientRect = () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON() {} }); };
beforeEach(reset);

describe('masking', () => {
  it('covers inputs, passwords, [data-bug-mask] and host selectors, but not buttons, checkboxes or the tool itself', () => {
    document.body.innerHTML = `<input id="a" value="x"><input id="p" type="password"><input id="c" type="checkbox"><input id="s" type="submit"><textarea id="t"></textarea><select id="sel"></select>
      <div id="m" data-bug-mask>secret</div><div id="h" class="host-secret">x</div><div id="plain">hello</div><div data-bug-ui><input id="ui"></div><input id="hidden" value="y">`;
    const ids = ['a', 'p', 'c', 's', 't', 'sel', 'm', 'h', 'plain', 'ui'];
    ids.forEach((id, i) => box(document.getElementById(id)!, 10 + i, 20 + i, 100, 30));
    box(document.getElementById('hidden')!, 0, 0, 0, 0);
    const rects = maskRects({ maskInputs: true, selectors: ['.host-secret'] });
    expect(rects.length).toBe(6); // a, p, t, sel, m, h
    expect(rects[0]).toEqual({ x: 16, y: 26, w: 100, h: 30 }); // explicit marks come first
  });
  it('with maskInputs off only explicit marks are covered', () => {
    document.body.innerHTML = '<input id="a" value="x"><input id="p" type="password"><b id="m" data-bug-mask>s</b>';
    ['a', 'p', 'm'].forEach((id, i) => box(document.getElementById(id)!, i, i, 50, 20));
    expect(maskRects({ maskInputs: false, selectors: [] }).length).toBe(2); // password and data-bug-mask are always covered
  });
  it('ignores invalid selectors instead of throwing', () => {
    document.body.innerHTML = '<b id="m" data-bug-mask>s</b>'; box(document.getElementById('m')!, 0, 0, 5, 5);
    expect(maskRects({ maskInputs: false, selectors: ['[[bad'] }).length).toBe(1);
    expect(selectorList(['.x'])).toBe('[data-bug-mask],input[type="password"],.x');
  });
});
