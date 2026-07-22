import { test, expect } from '@playwright/test';

test.describe('NexaOps smoke', () => {
  test('página de login carrega', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /entrar|login|nexaops/i }).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test('login → devices → tickets (se API estiver no ar)', async ({ page, request }) => {
    const health = await request.get(process.env.E2E_API_URL || 'http://localhost:3001/health').catch(() => null);
    test.skip(!health || !health.ok(), 'API indisponível — pulando fluxo E2E');

    await page.goto('/login');
    await page.locator('input[type="email"], input[name="email"]').first().fill('admin@nexaops.demo');
    await page.locator('input[type="password"]').first().fill('Admin@123');
    await page.getByRole('button', { name: /entrar|login/i }).first().click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 20000 });

    await page.goto('/devices');
    await expect(page.getByRole('heading', { name: /dispositivo|devices|frota/i }).first()).toBeVisible({
      timeout: 15000,
    });

    await page.goto('/tickets');
    await expect(page.getByRole('heading', { name: /ticket|chamado|helpdesk/i }).first()).toBeVisible({
      timeout: 15000,
    });
  });
});
