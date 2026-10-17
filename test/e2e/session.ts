import { expect, type Page } from '@playwright/test';

export async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Demo password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}
