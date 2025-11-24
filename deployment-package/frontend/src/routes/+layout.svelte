<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/styles/theme.css';
	import { theme } from '$lib/stores/theme';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';

	let { children } = $props();
	let sessionExpiredShown = $state(false);

	onMount(() => {
		const cleanup = theme.initialize();
		return cleanup;
	});

	// Check for session expiration after each navigation
	afterNavigate((navigation) => {
		if (!browser) return;

		// Check response headers for session expiration
		// This is set by hooks.server.ts when token refresh fails
		const response = navigation.from;
		if (!response) return;

		// Use fetch interceptor to check for session expiration headers
		const originalFetch = window.fetch;
		window.fetch = async (...args) => {
			const response = await originalFetch(...args);

			// Check if session expired during this request
			const sessionExpired = response.headers.get('X-Session-Expired');
			const reason = response.headers.get('X-Session-Expired-Reason');

			if (sessionExpired === 'true' && !sessionExpiredShown) {
				sessionExpiredShown = true;
				alert(
					`Your session has expired: ${reason || 'Please sign in again.'}\n\nYou will be redirected to the home page.`
				);
				// Reload to clear state and show login
				window.location.href = '/';
			}

			return response;
		};
	});

	$effect(() => {
		if (!browser) return;
		const current = $theme;
		document.body.classList.remove('theme-light', 'theme-dark');
		document.body.classList.add(`theme-${current}`);
		document.body.dataset.theme = current;
		document.documentElement.setAttribute('data-theme', current);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}
