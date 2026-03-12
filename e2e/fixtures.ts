import { test as base, chromium, Page, BrowserContext } from '@playwright/test';
import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';

const CDP_PORT = 9222;
const CDP_URL = `http://localhost:${CDP_PORT}`;
const DEV_SERVER_PORT = 1420;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const APP_PATH = path.resolve('src-tauri/target/debug/velocity.exe');

/**
 * Polls a URL until it responds with an OK status.
 */
async function waitForURL(
  url: string,
  timeout: number,
  label: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not ready yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} not available at ${url} after ${timeout}ms`);
}

/**
 * Kills a process tree on Windows using taskkill.
 */
function killProcessTree(pid: number): void {
  try {
    execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
  } catch {
    // Best effort — process may already be dead
  }
}

/**
 * Worker-scoped fixture: Vite dev server.
 * Starts once per worker (= once per test run with workers: 1)
 * and stays alive for all tests.
 */
type WorkerFixtures = {
  devServer: void;
};

/**
 * Test-scoped fixture: Tauri app + CDP page.
 * Launches a fresh app per test and connects Playwright via CDP.
 */
type TestFixtures = {
  appPage: Page;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker-scoped: start Vite dev server once for the entire worker
  devServer: [
    async ({}, use) => {
      // Check if a dev server is already running on the port
      let devServerPid: number | null = null;
      let devServer: ChildProcess | null = null;

      try {
        await fetch(DEV_SERVER_URL);
        // Dev server already running — skip starting one
        console.log('[fixture] Dev server already running on port', DEV_SERVER_PORT);
      } catch {
        // Not running — start one
        devServer = spawn('npx', ['vite', '--port', String(DEV_SERVER_PORT)], {
          cwd: path.resolve('.'),
          shell: true,
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        devServerPid = devServer.pid ?? null;

        devServer.stderr?.on('data', (data: Buffer) => {
          const msg = data.toString().trim();
          if (msg && !msg.includes('ExperimentalWarning'))
            console.error(`[vite stderr] ${msg}`);
        });

        await waitForURL(DEV_SERVER_URL, 30_000, 'Vite dev server');
        console.log('[fixture] Vite dev server started on port', DEV_SERVER_PORT);
      }

      await use();

      // Cleanup: kill the dev server if we started one
      if (devServerPid) {
        killProcessTree(devServerPid);
        console.log('[fixture] Vite dev server stopped');
      }
    },
    { scope: 'worker' },
  ],

  // Test-scoped: launch Tauri app, connect via CDP, provide the page
  appPage: async ({ devServer: _ }, use) => {
    let app: ChildProcess | null = null;
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null =
      null;

    try {
      // Launch the Tauri app with CDP debugging enabled
      app = spawn(APP_PATH, [], {
        env: {
          ...process.env,
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
        },
      });

      app.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.error(`[velocity stderr] ${msg}`);
      });

      // Wait for CDP to be available
      await waitForURL(`${CDP_URL}/json/version`, 30_000, 'CDP endpoint');

      // Connect Playwright to the WebView2 via CDP
      browser = await chromium.connectOverCDP(CDP_URL);
      const context: BrowserContext = browser.contexts()[0];
      const page: Page = context.pages()[0] || (await context.newPage());

      // Wait for the app to render
      await page.waitForSelector('[data-testid="shell-selector"]', {
        timeout: 30_000,
      });

      await use(page);
    } finally {
      // Cleanup: close browser connection, then kill the app
      if (browser) {
        await browser.close().catch(() => {});
      }
      if (app?.pid) {
        killProcessTree(app.pid);
      }
      // Give the app time to fully terminate and release the CDP port
      await new Promise((r) => setTimeout(r, 2000));
    }
  },
});

export { expect } from '@playwright/test';
