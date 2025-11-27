import prettier from 'eslint-config-prettier';
import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Ignore patterns for generated files, build outputs, and documentation
	{
		ignores: [
			'build/**',
			'dist/**',
			'.svelte-kit/**',
			'coverage/**',
			'static/vendor/**',
			'**/*.min.js',
			'**/*.bundle.js',
			'**/*.md'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			// Enforce consistent type imports for better tree-shaking and clearer intent
			'@typescript-eslint/consistent-type-imports': 'warn'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
	// SvelteKit client-side overrides
	// These rules are relaxed for SvelteKit's navigation pattern where promises
	// don't need to be awaited (fire-and-forget navigation like `void goto()`)
	{
		files: ['src/**/stores/**', 'src/**/routes/**', 'src/**/*.svelte'],
		rules: {
			// allow un-awaited client-side navigation calls like `void goto('/path')`
			'@typescript-eslint/no-floating-promises': 'off',
			// some svelte-specific rules are noisy for this project in client files
			'svelte/no-navigation-without-resolve': 'off',
			'svelte/prefer-svelte-reactivity': 'off',
			// allow unused bindings that start with underscore in client stores
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			]
		}
	},
	// Relax some rules for test files
	{
		files: ['tests/**', 'tests/**/*.ts', 'tests/**/*.svelte.test.ts', 'tests/**/*.svelte.ts'],
		rules: {
			// disallow `as any` in tests to encourage typed mocks and safer assertions
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			]
		}
	}
);
