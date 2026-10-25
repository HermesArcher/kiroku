'use strict';
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.js',
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 30000 },
  retries: 0,
  reporter: [['list']],
});
