// The complete turn list for a ChatGPT conversation.
//
// ChatGPT virtualizes harder than claude.ai and leaves nothing to count. Its
// unrendered turns are empty divs whose class reserves their height, and only
// the ones beside the mounted window exist at all: a conversation with 64 turns
// had about ten rows mounted and five placeholders. So there is no arithmetic
// that recovers the length from the page, the way claude.ai's single spacer and
// row indices do.
//
// The page's own data is behind /backend-api/conversation/<id>, which answers
// 404 to cookies alone - it wants the session access token as a bearer. That is
// a step up from the claude.ai path, where cookies alone sufficed, and it was
// turned on deliberately rather than assumed.
//
// The token is read from the page's own session endpoint, held in a closure for
// the life of the tab, and sent to exactly one host: the one it came from. It
// is never logged, never stored, never put in the DOM, and never travels
// anywhere else. Search this file for `token` and every use is visible.
//
// The payload is a tree, not a list. Its mapping holds every edit and
// regeneration ever made; the conversation as displayed is the path from
// `current_node` back up through `parent`. Counting the mapping would overcount
// by every branch abandoned along the way - 165 nodes against 156 on the branch
// in the conversation this was built from.
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	root.__CHATNAV = root.__CHATNAV || {};
	root.__CHATNAV.chatgptApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

	const HOSTS = /^((www\.)?chatgpt\.com|chat\.openai\.com)$/;

	function textOf(message) {
		const content = message && message.content;
		const parts = content && content.parts;
		if (!Array.isArray(parts)) return '';
		// Multimodal turns put objects in here alongside the strings; only the
		// strings are anything anyone typed.
		return parts.filter(p => typeof p === 'string').join('\n').trim();
	}

	// ChatGPT injects user-role messages that it never shows - custom
	// instructions and the like. They are not turns.
	function hidden(message) {
		const meta = message && message.metadata;
		return !!(meta && meta.is_visually_hidden_from_conversation);
	}

	// Pure: walk the live branch, oldest first. Kept separate from the fetching
	// so the tree handling can be tested without a network.
	function turnsFromConversation(payload) {
		const mapping = payload && payload.mapping;
		const leaf = payload && payload.current_node;
		if (!mapping || !leaf || !mapping[leaf]) return null;

		const branch = [];
		const seen = new Set();
		let node = mapping[leaf];
		while (node && !seen.has(node.id || node)) {
			if (node.id) seen.add(node.id);          // a malformed cycle must not hang
			if (node.message) branch.push(node.message);
			node = node.parent ? mapping[node.parent] : null;
		}
		branch.reverse();

		const turns = [];
		branch.forEach((message, position) => {
			const role = message.author && message.author.role;
			if (role !== 'user' || hidden(message)) return;
			const text = textOf(message);
			if (!text) return;
			turns.push({ id: message.id || null, row: position, text });
		});
		if (!turns.length) return null;
		// Every message on the branch, in order. A mounted message carries its id
		// on the element, so this is what turns "which message is on screen" into
		// "how far through the conversation are we" - the ChatGPT equivalent of
		// the row index claude.ai puts in the DOM.
		return { turns, total: branch.length, order: branch.map(m => m.id || null) };
	}

	function conversationId() {
		const m = /^\/c\/([0-9a-f-]{16,})/i.exec(location.pathname);
		return m ? m[1] : null;
	}

	function supports() {
		return HOSTS.test(location.hostname) && !!conversationId();
	}

	// Pinned to this origin, never left relative.
	//
	// A relative URL handed to fetch() resolves against the *document's* base
	// URL, and a page can set that with a single <base href> tag - no script
	// needed, so even a CSP that blocks inline script would not prevent it.
	// Everything here carries the user's session token, and a token is not
	// something to send wherever the page's markup happens to point. Redirects
	// are already safe: Chrome strips Authorization on a cross-origin one.
	function here(path) {
		return new URL(path, location.origin).toString();
	}

	let tokenPromise = null;
	function sessionToken() {
		if (tokenPromise) return tokenPromise;
		tokenPromise = fetch(here('/api/auth/session'), { credentials: 'same-origin' })
			.then(r => (r.ok ? r.json() : null))
			.then(j => (j && j.accessToken) || null)
			.catch(() => null);
		return tokenPromise;
	}

	let cache = null;   // { id, data }

	async function fetchOnce(id, token) {
		return fetch(here('/backend-api/conversation/' + id), {
			credentials: 'same-origin',
			headers: { Authorization: 'Bearer ' + token },
		});
	}

	async function load() {
		const id = conversationId();
		if (!id) return null;
		if (cache && cache.id === id) return cache.data;

		let token = await sessionToken();
		if (!token) return null;

		let res = null;
		try {
			res = await fetchOnce(id, token);
			if (res.status === 401 || res.status === 403) {
				// Expired while the tab sat open. One fresh attempt, then give up
				// and let the DOM answer instead.
				tokenPromise = null;
				token = await sessionToken();
				if (!token) return null;
				res = await fetchOnce(id, token);
			}
			if (!res.ok) return null;
		} catch (e) {
			return null;
		}

		let parsed = null;
		try { parsed = turnsFromConversation(await res.json()); }
		catch (e) { return null; }

		if (parsed) cache = { id, data: parsed };
		return parsed;
	}

	return { textOf, hidden, turnsFromConversation, conversationId, supports, load };
});
