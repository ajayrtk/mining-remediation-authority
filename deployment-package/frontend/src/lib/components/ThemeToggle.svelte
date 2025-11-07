<script lang="ts">
	import { theme } from '$lib/stores/theme';

	let { variant = 'inline' }: { variant?: 'inline' | 'floating' } = $props();

	const toggleTheme = () => theme.toggleTheme();

	const classes = $derived(() => `theme-toggle ${variant === 'floating' ? 'floating' : 'inline'}`);
</script>

<button
	type="button"
	class={classes}
	aria-label={$theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
	aria-pressed={$theme === 'dark'}
	onclick={toggleTheme}
>
	<span class="icon" aria-hidden="true">{$theme === 'light' ? '🌙' : '☀️'}</span>
	<span class="sr-only">{$theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}</span>
	{#if variant === 'floating'}
			<span class="label">{$theme === 'light' ? 'Dark' : 'Light'} mode</span>
	{/if}
</button>

<style>
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
		padding: 0.55rem 1.1rem;
		border-radius: 999px;
		border: 1px solid var(--toggle-border);
		background: var(--toggle-bg);
		color: var(--toggle-text);
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
		transition: transform 0.25s ease, background 0.25s ease, border 0.25s ease;
		box-shadow: var(--shadow-elevated);
	}

	.theme-toggle.inline {
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border-radius: 999px;
		background: var(--button-ghost-bg);
		border: 1px solid var(--button-ghost-border);
		color: var(--button-ghost-text);
		box-shadow: none;
	}

	.theme-toggle.inline:hover {
		background: var(--button-ghost-hover);
		border-color: var(--button-ghost-hover);
	}

	.theme-toggle.inline:focus-visible {
		outline: 3px solid var(--accent-soft);
		outline-offset: 2px;
	}

	.theme-toggle:not(.inline):hover {
		background: var(--toggle-hover);
		border-color: var(--toggle-hover);
		transform: translateY(-1px);
	}

	.theme-toggle:focus-visible {
		outline: 3px solid var(--accent-soft);
		outline-offset: 2px;
	}

	.theme-toggle.floating {
		position: fixed;
		right: 1.5rem;
		bottom: 1.5rem;
		z-index: 1000;
		background: var(--button-ghost-bg);
		border: 1px solid var(--button-ghost-border);
		color: var(--button-ghost-text);
		box-shadow: var(--panel-shadow);
	}

	.theme-toggle.floating:hover {
		background: var(--button-ghost-hover);
		border-color: var(--button-ghost-hover);
		transform: translateY(-2px);
	}

	.icon {
		font-size: 1.05rem;
		line-height: 1;
	}

	.label {
		white-space: nowrap;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 540px) {
		.theme-toggle {
			padding: 0.5rem 0.9rem;
			font-size: 0.85rem;
		}

		.theme-toggle.floating {
			right: 1rem;
			bottom: 1rem;
		}
	}
</style>
