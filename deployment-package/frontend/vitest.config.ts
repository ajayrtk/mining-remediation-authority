import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			exclude: [
				'node_modules/**',
				'build/**',
				'.svelte-kit/**',
				'**/*.config.{js,ts}',
				'**/*.d.ts',
				'**/types/**',
				'**/__tests__/**',
				'**/*.test.{js,ts}',
				'**/*.spec.{js,ts}'
			],
			// Coverage thresholds
			thresholds: {
				lines: 70,
				functions: 70,
				branches: 70,
				statements: 70
			}
		},
		globals: true,
		setupFiles: []
	}
});
