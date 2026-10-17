import { expect, test } from '@playwright/test';
import { signIn } from './session';

test('phone: the button sits clear of the chat bubble and inside the safe area, the sheet fits', async ({ page }) => {
  await signIn(page);
  await page.goto('/?bugs=1');
  const fab = (await page.locator('.fab').boundingBox())!, chat = (await page.locator('#chat').boundingBox())!, vp = page.viewportSize()!;
  expect(fab.x + fab.width).toBeLessThanOrEqual(vp.width); expect(fab.y + fab.height).toBeLessThanOrEqual(vp.height);
  const overlap = !(fab.x + fab.width <= chat.x || chat.x + chat.width <= fab.x || fab.y + fab.height <= chat.y || chat.y + chat.height <= fab.y);
  expect(overlap).toBe(false);
  expect(fab.width).toBeGreaterThanOrEqual(44);
  await page.locator('.fab').click();
  const menu = (await page.locator('.menu').boundingBox())!; expect(menu.x).toBeGreaterThanOrEqual(0); expect(menu.x + menu.width).toBeLessThanOrEqual(vp.width);
  await page.getByRole('menuitem', { name: /Report a problem/ }).click();
  await page.getByRole('button', { name: 'Whole screen' }).click();
  const sheet = (await page.locator('.sheet').boundingBox())!;
  expect(sheet.x).toBeGreaterThanOrEqual(0); expect(sheet.x + sheet.width).toBeLessThanOrEqual(vp.width + 1);
  const font = await page.locator('textarea').evaluate(el => getComputedStyle(el).fontSize); expect(parseFloat(font)).toBeGreaterThanOrEqual(16); // no iOS zoom on focus
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
