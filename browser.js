// Temporary no-op module to satisfy an environment import path used by the test runner.
// Some vitest/browser internals may attempt to load a './browser' module path from the
// project root during environment boot; creating this harmless stub prevents an
// unhandled module-not-found error during the coverage run.

// Minimal environment shim for Vitest's browser environment loader.
// Provide the required `transformMode` indicator so the runner recognizes this as
// a valid browser environment module.
export default {
	transformMode: 'web',
	// Minimal lifecycle hooks expected by Vitest's environment loader.
	async setup() {
		// Return a minimal environment handle if requested by the runner.
		return {};
	},
	async teardown() {
		return;
	}
};
