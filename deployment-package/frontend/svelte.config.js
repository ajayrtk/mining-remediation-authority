import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Use Node adapter for production deployment on ECS
		adapter: adapter({
			out: 'build',
			precompress: false,
			envPrefix: '',
			// Trust proxy headers from CloudFront/ALB (X-Forwarded-Proto, X-Forwarded-Host)
			// This ensures url.origin uses the CloudFront URL for Cognito redirects
			xff_depth: 2
		})
	}
};

export default config;
