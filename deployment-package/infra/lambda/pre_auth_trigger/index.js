// Pre-auth trigger - validates user email domain (only allows stfc.ac.uk)

const ALLOWED_DOMAIN = 'stfc.ac.uk';

exports.handler = async (event) => {
	console.log('Pre-authentication trigger invoked', {
		userPoolId: event.userPoolId,
		userName: event.userName,
		triggerSource: event.triggerSource
	});

	const email = event.request.userAttributes.email;

	if (!email) {
		console.error('No email attribute found for user', event.userName);
		throw new Error(`Only @${ALLOWED_DOMAIN} email addresses are allowed to sign in.`);
	}

	const emailParts = email.toLowerCase().split('@');
	if (emailParts.length !== 2) {
		console.error('Invalid email format', { email });
		throw new Error(`Only @${ALLOWED_DOMAIN} email addresses are allowed to sign in.`);
	}

	const domain = emailParts[1];

	if (domain !== ALLOWED_DOMAIN) {
		console.warn('Domain validation failed', {
			email,
			domain,
			allowedDomain: ALLOWED_DOMAIN
		});
		throw new Error(`Only @${ALLOWED_DOMAIN} email addresses are allowed to sign in.`);
	}

	console.log('Domain validation passed', { email, domain });
	return event;
};
