export const MIN_PASSWORD_LENGTH = 12;
// scrypt takes as long as the password is, so an absurdly long one is a way to tie the server up.
export const MAX_PASSWORD_LENGTH = 200;

// null when fine, otherwise the sentence to show.
export function getPasswordProblem(password) {
	if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
		return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
	}
	if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
	return null;
}
