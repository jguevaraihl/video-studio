/** Comprueba en qué modo corre la página. Se ejecuta en ambos servidores (con y sin COOP/COEP). */
import { test, expect } from '@playwright/test';

test('informa el estado del aislamiento entre orígenes', async ({ page }) => {
  await page.goto('/');
  const iso = await page.evaluate(() => crossOriginIsolated);
  expect(iso).toBe(process.env.VS_NO_ISOLATION !== '1');
});
