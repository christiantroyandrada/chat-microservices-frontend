import { test as base, expect as baseExpect } from '@playwright/test';
import setupMockBackend from './mockBackend';

export const test = base.extend({});
export const expect = baseExpect;

// Install mock backend automatically for every test that uses the shared `test`
test.beforeEach(async ({ page }) => {
	await setupMockBackend(page);
});

export default test;
