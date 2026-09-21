// The complete turn list for a claude.ai conversation.
//
// The DOM cannot answer this. claude.ai virtualizes its transcript: only the
// handful of rows near the viewport exist, and everything above them is
// replaced by one `transcript-spacer` div holding their collected height. A
// 38-turn conversation had 2 rows in the page and a 26,988px spacer, which is
// why counting rows reported "2 turns".
//
// Scrolling to force the rest to render was tried and abandoned. Each scroll
// makes the virtualizer re-render heavy rows, and walking a 29,535px transcript
// that way wedged the renderer for longer than the tooling would wait. It is
// the wrong shape of answer anyway - a summary should not have to repaint the
// whole conversation to be built.
//
// So the outline comes from the same endpoint the page itself loads, read with
// the user's own session, and nothing leaves the origin. Every message carries
// an `index` that matches the DOM's `data-index` exactly, which is what makes
// jumping to an unrendered turn possible at all.
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	root.__CHATNAV = root.__CHATNAV || {};
	root.__CHATNAV.claudeApi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

	// The `text` field is empty on current conversations; the words live in
	// content blocks. Thinking blocks are skipped - they are not what anyone
	// typed, and only text blocks carry a prompt.
	function textOf(message) {
		const blocks = message && message.content;
		if (Array.isArray(blocks)) {
			const joined = blocks
				.filter(b => b && b.type === 'text')
				.map(b => b.text || '')
				.join('\n')
				.trim();
			if (joined) return joined;
		}
		return String((message && message.text) || '').trim();
	}

	// Pure, so the shape of the response can be tested without a network.
	function turnsFromConversation(payload) {
		const messages = payload && payload.chat_messages;
		if (!Array.isArray(messages) || !messages.length) return null;

		const turns = [];
		messages.forEach((message, position) => {
			if (!message || message.sender !== 'human') return;
			const row = typeof message.index === 'number' ? message.index : position;
			turns.push({ row, text: textOf(message) });
		});
		if (!turns.length) return null;
		return { turns, total: messages.length };
	}

	function conversationId() {
		const m = /^\/chat\/([0-9a-f-]{16,})/i.exec(location.pathname);
		return m ? m[1] : null;
	}

	// Pinned to this origin rather than left relative: a page can retarget a
	// relative fetch with one <base href> tag. No token rides along here, only
	// cookies, which the browser would withhold from another origin anyway -
	// but the two loaders should not differ on something like this.
	function here(path) {
		return new URL(path, location.origin).toString();
	}

	let orgPromise = null;
	function organisation() {
		if (orgPromise) return orgPromise;
		orgPromise = fetch(here('/api/organizations'), { credentials: 'same-origin' })
			.then(r => (r.ok ? r.json() : null))
			.then(list => (Array.isArray(list) && list.length ? list[0].uuid : null))
			.catch(() => null);
		return orgPromise;
	}

	function supports() {
		return /^(www\.)?claude\.ai$/.test(location.hostname) && !!conversationId();
	}

	let cache = null;   // { id, total, data }

	/**
	 * @param {number|null} knownTotal  row count the DOM believes in, used to
	 *        notice that the conversation has grown since it was last read.
	 */
	async function load(knownTotal) {
		const id = conversationId();
		if (!id) return null;
		if (cache && cache.id === id &&
			(!knownTotal || knownTotal === cache.total)) return cache.data;

		const org = await organisation();
		if (!org) return null;

		const url = here('/api/organizations/' + org + '/chat_conversations/' + id +
			'?tree=True&rendering_mode=messages');
		let payload = null;
		try {
			const res = await fetch(url, { credentials: 'same-origin' });
			if (!res.ok) return null;
			payload = await res.json();
		} catch (e) {
			return null;
		}

		const parsed = turnsFromConversation(payload);
		if (parsed) cache = { id, total: parsed.total, data: parsed };
		return parsed;
	}

	return { textOf, turnsFromConversation, conversationId, supports, load };
});
