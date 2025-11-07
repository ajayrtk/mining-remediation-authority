<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '$lib/styles/theme.css';
	import { theme } from '$lib/stores/theme';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	let { children } = $props();

	onMount(() => {
		const cleanup = theme.initialize();
		return cleanup;
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
