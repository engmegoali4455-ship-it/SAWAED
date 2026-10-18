import { defineConfig } from '@playwright/test';

// يتطلب: supabase start + الاستيراد + scripts/dev-seed-users.ts، والبناء (npm run build).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? undefined },
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_BASE_URL ? undefined : { command: 'npx serve out -l 3000', port: 3000, reuseExistingServer: true },
});
