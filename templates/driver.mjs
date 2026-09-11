export default {
  apiVersion: 1,
  status: {
    productionReady: false,
    mutatesState: false,
    todos: [
      'Replace placeholder locators with selectors proven against the running app.',
      'Implement each normalized scene and its event-driven success boundary.',
      'Implement a meaningful state snapshot and restoration assertion.',
    ],
  },

  async authenticate({ page, manifest }) {
    // For authenticated apps, use only values from `secrets`, complete login
    // here, and wait for a post-login success boundary. Login is never recorded.
    await page.goto(manifest.app.url);
  },

  async prepare({ page }) {
    // Set theme, presentation mode, or local storage in the auth context.
    await page.waitForLoadState('domcontentloaded');
  },

  async setup({ page, manifest }) {
    await page.goto(manifest.app.url);
    await page.locator('body').waitFor({ state: 'visible' });
  },

  async snapshot({ page }) {
    return { url: page.url() };
  },

  async run() {
    throw new Error(
      'Driver scaffold is not recording-ready. Probe the app, implement scene actions, and clear status.todos.',
    );
  },

  async restore() {
    // Restore any state changed by a partially completed take.
  },

  async verifyRestored({ before, after }) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('Application state differs from the pre-take snapshot');
    }
  },
};
