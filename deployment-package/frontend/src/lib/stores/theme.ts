import { browser } from '$app/environment';
import { writable } from 'svelte/store';

const STORAGE_KEY = 'preferred-theme';
const THEMES = ['light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

const isTheme = (value: unknown): value is Theme =>
	typeof value === 'string' && THEMES.includes(value as Theme);

const createThemeStore = () => {
	const { subscribe, set, update } = writable<Theme>('light');
	let initialized = false;

	const persist = (value: Theme) => {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, value);
		} catch (error) {
			console.warn('Unable to persist theme preference', error);
		}
	};

	const initialize = () => {
		if (!browser || initialized) return;
		initialized = true;

		const stored = localStorage.getItem(STORAGE_KEY);
		if (isTheme(stored)) {
			set(stored);
		} else {
			set('light');
			persist('light');
		}

		const onStorage = (event: StorageEvent) => {
			if (event.key !== STORAGE_KEY) return;
			if (isTheme(event.newValue)) {
				set(event.newValue);
			}
		};

		window.addEventListener('storage', onStorage);
		return () => window.removeEventListener('storage', onStorage);
	};

	const setTheme = (value: Theme) => {
		set(value);
		persist(value);
	};

	const toggleTheme = () => {
		let next: Theme = 'light';
		update((current) => {
			next = current === 'light' ? 'dark' : 'light';
			return next;
		});
		persist(next);
	};

	return {
		subscribe,
		initialize,
		setTheme,
		toggleTheme
	};
};

export const theme = createThemeStore();
