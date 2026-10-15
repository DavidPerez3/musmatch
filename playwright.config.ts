import { defineConfig } from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: true, workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', {open:'never'}]],
  use: {baseURL:'http://127.0.0.1:4173/musmatch/', serviceWorkers:'block',
    launchOptions:{executablePath:path.resolve('.browser/chromium'),
      args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-software-rasterizer']},
    screenshot:'only-on-failure', trace:'retain-on-failure'},
  webServer:{command:'node tests/browser/server.mjs', port:4173, reuseExistingServer:!process.env.CI},
});
