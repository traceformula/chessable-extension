// Which selectors find the turns, per site.
//
// Deliberately a table rather than code: these break when the sites reshuffle
// their markup, and a broken one should be a one-line edit here. Each list is a
// fallback chain tried in order, first non-empty result wins.
//
// Measured 2026-09-20 on live pages. Note the dead entry kept in chatgpt's
// chain: `article[data-testid^="conversation-turn"]` is the selector every
// article on the web still quotes, and it now matches nothing. That is the
// expected failure mode here, so the code reports when a chain comes up empty
// rather than quietly showing no turns.
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	root.__CHATNAV = root.__CHATNAV || {};
	root.__CHATNAV.sites = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

	const SITES = [
		{
			name: 'claude.ai',
			host: /^(www\.)?claude\.ai$/,
			user: ['[data-testid="user-message"]'],
			assistant: ['[data-testid="assistant-message"]', '.font-claude-response'],
			// claude.ai keeps only the rows near the viewport; the rest of the
			// transcript is one spacer div holding their collected height. Each
			// row carries data-index, which matches the message index the API
			// reports, and that is what makes jumping to an unrendered turn work.
			row: '[data-testid="transcript-row"]',
			spacer: '[data-testid="transcript-spacer"]',
			// Verified present; anything promotional lives outside the transcript.
			noise: ['[data-testid*="upsell"]', '[class*="upgrade-banner"]'],
		},
		{
			name: 'chatgpt',
			host: /^(www\.)?chatgpt\.com$/,
			user: ['[data-message-author-role="user"]'],
			assistant: ['[data-message-author-role="assistant"]'],
			noise: ['[data-testid*="promo"]', '[data-testid*="upsell"]'],
		},
		{
			name: 'chatgpt (openai)',
			host: /^chat\.openai\.com$/,
			user: ['[data-message-author-role="user"]'],
			assistant: ['[data-message-author-role="assistant"]'],
			noise: ['[data-testid*="promo"]', '[data-testid*="upsell"]'],
		},
	];

	function siteFor(hostname) {
		return SITES.find(s => s.host.test(String(hostname))) || null;
	}

	return { SITES, siteFor };
});
