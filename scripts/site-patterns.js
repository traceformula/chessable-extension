// Turning what someone types into the match patterns a site needs.
//
// Pure string work, shared by the options page and testable in node, because
// every mistake in here is a site that silently does nothing.
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	root.__KBM = root.__KBM || {};
	root.__KBM.sitePatterns = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

	// Covered by the manifest already. Registering them at runtime as well would
	// inject everything twice, and listing them as removable extras would be a
	// lie: removing them does nothing, since the manifest does not ask.
	const BUILT_IN = [
		'chess.com', 'www.chess.com',
		'chessable.com', 'www.chessable.com',
		'lichess.org', 'www.lichess.org',
		'clubxiangqi.com', 'www.clubxiangqi.com',
		'claude.ai', 'www.claude.ai',
		'chatgpt.com', 'www.chatgpt.com',
		'chat.openai.com',
	];

	// A development server on this machine. These are the only hosts for which
	// http is offered at all: the manifest asks for https everywhere and http
	// nowhere else, so a plaintext grant cannot be handed out for the open web.
	const LOOPBACK = /^(localhost|127\.0\.0\.1|[^.]+\.localhost)$/i;

	function hostOf(origin) {
		// "https://*.youtube.com/*" is not a parseable URL, so read the host
		// directly and drop the wildcard: both forms of a site are one name.
		const m = /^https?:\/\/([^/]+)/.exec(String(origin));
		return m ? m[1].replace(/^\*\./, '') : String(origin);
	}

	/**
	 * Accepts "example.com", "www.example.com/path", a full URL, or a local
	 * address like "http://localhost:4173".
	 * @returns {string[]|null} the patterns to ask for, or null if unusable
	 */
	function patternsFor(raw) {
		const text = String(raw == null ? '' : raw).trim();
		if (!text) return null;

		let url;
		try {
			url = new URL(text.includes('://') ? text : 'https://' + text);
		} catch (e) {
			return null;
		}
		const host = url.hostname;
		if (!host) return null;

		if (LOOPBACK.test(host)) {
			// This host alone: there is no apex and no www to miss here, and a
			// wildcard over localhost would be a wide thing to hold for no gain.
			// The port is dropped because match patterns have none - one grant
			// covers 4173, 5173 and every other port on the host.
			//
			// Typing "localhost:4173" with no scheme asks for both, because a dev
			// server is usually http and guessing https would hand back a grant
			// that silently matches nothing. It is still one prompt, and still
			// only this machine.
			if (!text.includes('://')) {
				return ['http://' + host + '/*', 'https://' + host + '/*'];
			}
			const scheme = url.protocol === 'http:' ? 'http' : 'https';
			return [scheme + '://' + host + '/*'];
		}

		// A bare word that is not a local address is a typo, not a site.
		if (!host.includes('.')) return null;

		// "https://youtube.com/*" does not match www.youtube.com - match patterns
		// are host-exact - so asking only for what was typed enables the site
		// everywhere except where people actually go. The apex and a subdomain
		// wildcard together are one prompt.
		const base = host.replace(/^www\./, '');
		return ['https://' + base + '/*', 'https://*.' + base + '/*'];
	}

	return { BUILT_IN, LOOPBACK, hostOf, patternsFor };
});
