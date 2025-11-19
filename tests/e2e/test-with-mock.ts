import { test as base } from '@playwright/test';
import setupMockBackend from './mockBackend';

export { expect } from '@playwright/test';

export const test = base.extend({});

// Install mock backend automatically for every test that uses the shared `test`
test.beforeEach(async ({ page }) => {
	await setupMockBackend(page);
});

export default test;
