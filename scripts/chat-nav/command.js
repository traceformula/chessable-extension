// The ":" command line. Pure parsing, no DOM, so it can be tested in node.
//
// Vim's own shapes where they fit: ":42" jumps to a turn the way ":42" jumps to
// a line, "$" is the last one, and a command may be shortened to any unique
// prefix. The names are chosen so every first letter is already unique - so
// ":c", ":e", ":l", ":m", ":h" and ":q" all resolve on one keystroke.
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	root.__CHATNAV = root.__CHATNAV || {};
	root.__CHATNAV.command = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

	const COMMANDS = [
		{ name: 'ls', help: 'list the turns, then :N to jump' },
		{ name: 'collapse', help: 'fold every reply down to a few lines' },
		{ name: 'expand', help: 'unfold them again' },
		{ name: 'mute', help: 'hide banners and promos on the page' },
		{ name: 'help', help: 'this list' },
		{ name: 'quit', help: 'close the panel' },
	];

	/**
	 * @param {string} raw  what was typed after the colon
	 * @returns {{kind:string, turn?:number|'last', name?:string, text?:string,
	 *            matches?:string[]}}
	 */
	function parse(raw) {
		const text = String(raw == null ? '' : raw).trim();
		if (!text) return { kind: 'none' };

		if (/^\d+$/.test(text)) {
			const turn = parseInt(text, 10);
			// ":0" names no turn - they are counted from one, as vim counts lines.
			if (turn < 1) return { kind: 'unknown', text };
			return { kind: 'jump', turn };
		}
		if (text === '$') return { kind: 'jump', turn: 'last' };

		const word = text.toLowerCase();
		const exact = COMMANDS.find(c => c.name === word);
		if (exact) return { kind: exact.name, name: exact.name };

		const hits = COMMANDS.filter(c => c.name.startsWith(word));
		if (hits.length === 1) return { kind: hits[0].name, name: hits[0].name };
		if (hits.length > 1) {
			return { kind: 'ambiguous', text, matches: hits.map(c => c.name) };
		}
		return { kind: 'unknown', text };
	}

	return { parse, COMMANDS };
});
