import { defineConfig } from '@playwright/test';

const noIso = process.env.VS_NO_ISOLATION === '1';
const port = noIso ? 5174 : 5173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 }, trace: 'off' },
  webServer: {
    command: noIso ? 'npm run dev:web:sin-aislamiento' : 'npm run dev',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
    env: noIso ? { VS_NO_ISOLATION: '1' } : {},
  },
});
