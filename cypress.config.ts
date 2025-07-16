import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
  // default username / password on init
  env: {
    analytics_user: 'admin',
    analytics_password: 'analytics',
    analytics_user_id: '41e2b680-648e-4b09-bcd7-3e2b10c06264',
  },
});
