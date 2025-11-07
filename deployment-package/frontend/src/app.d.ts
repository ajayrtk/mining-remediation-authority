// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user: import('./lib/server/cognito').CognitoUser | null;
		}

		interface PageData {
			user: import('./lib/server/cognito').CognitoUser | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
