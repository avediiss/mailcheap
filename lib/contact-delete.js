// Deleting a contact (the right to erasure) removes their address from the list, their name, tags and
// engagement. Two things stay, on purpose:
// - Someone who unsubscribed, bounced or complained stays on the do-not-email list, address only, so an
//   old CSV or a form can't add them back and email someone who said no.
// - The emails already sent keep their numbers (campaign reports), with the address replaced.
const SUPPRESSION_REASONS = { unsubscribed: "manual", bounced: "bounce", complained: "complaint" };

export function getSuppressionReasonOnDelete(status) {
	return SUPPRESSION_REASONS[status] ?? null;
}

// Not a deliverable address (.invalid is reserved), and it still differs per contact.
export function getErasedEmail(contactId) {
	return `deleted-${contactId}@deleted.invalid`;
}
