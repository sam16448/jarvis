import { defineConfig, devices } from '@playwright/test';

const iphone = { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } as Record<string, unknown>;
delete iphone.defaultBrowserType;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  retries: 0,
  reporter: 'list',
  use: {
    ...iphone,
    // Uses the installed Google Chrome so no extra browser download is needed.
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:4173/',
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'npx vite --port 4173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4173/', reuseExistingServer: true },
});
