// Resolves typed text like "nf3", "Bxc4", "e8", "oo", "e2e4" against a list of
// legal moves. Pure logic, no DOM: also loadable in node for the test suite.
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	root.__KBM = root.__KBM || {};
	root.__KBM.matcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

	const PIECES = 'NBRQK';

	// Fold a SAN string (or typed buffer) into the canonical form we match on:
	// lowercase, no check/mate/annotation marks, no separators, 0-0 spelled oo.
	function canon(s) {
		return String(s)
			.replace(/[+#!?\s\-]/g, '')
			.replace(/=/g, '')
			.replace(/0/g, 'o')
			.toLowerCase();
	}

	// Every string the user could plausibly type for this move. A capture can be
	// typed with or without the "x", and any move can be given in UCI instead.
	function forms(move) {
		const out = new Set();
		const c = canon(move.san);
		out.add(c);
		if (c.includes('x')) out.add(c.replace(/x/g, ''));

		// A disambiguated piece move is also accepted without its disambiguator:
		// typing "nd2" with two knights available should offer both, not nothing.
		// Pawn moves are excluded - dropping the file from "exd5" would collide
		// with the unrelated pawn push "d5".
		const dis = /^([nbrqk])[a-h1-8](x?)([a-h][1-8].*)$/.exec(c);
		if (dis) out.add(dis[1] + dis[2] + dis[3]);
		if (dis && dis[2]) out.add(dis[1] + dis[3]);

		if (move.from && move.to) {
			const uci = canon(move.from + move.to);
			out.add(uci);
			if (move.promotion) out.add(uci + canon(move.promotion));
		}
		return [...out];
	}

	function promotionOf(move) {
		if (move.promotion) return canon(move.promotion);
		const m = /=([QRBN])/i.exec(move.san || '');
		return m ? m[1].toLowerCase() : null;
	}

	// All candidates are the same from/to and differ only in promotion piece,
	// so "e8" can commit as the queen rather than stalling on a 4-way tie.
	function collapsePromotions(candidates, preferred) {
		if (candidates.length < 2) return candidates;
		const first = candidates[0];
		const same = candidates.every(m =>
			m.from === first.from && m.to === first.to && promotionOf(m));
		if (!same) return candidates;
		const pick = candidates.find(m => promotionOf(m) === canon(preferred));
		return pick ? [pick] : candidates;
	}

	/**
	 * @param {string} raw     what the user has typed so far
	 * @param {Array}  moves   legal moves, each {san, from, to, promotion?}
	 * @param {object} [opts]  {promotion: 'q'}
	 * @returns {{state:'empty'|'none'|'ambiguous'|'unique', move?, candidates}}
	 */
	function match(raw, moves, opts) {
		const preferred = (opts && opts.promotion) || 'q';
		if (!raw) return { state: 'empty', candidates: [] };

		const buf = canon(raw);
		if (!buf) return { state: 'empty', candidates: [] };

		let candidates = moves.filter(m => forms(m).some(f => f.startsWith(buf)));

		// An uppercase leading piece letter is an explicit signal: "Bc4" means the
		// bishop, never the b-pawn. Only narrow when it actually resolves something.
		const lead = raw[0];
		if (PIECES.includes(lead)) {
			const narrowed = candidates.filter(m => (m.san || '')[0] === lead);
			if (narrowed.length) candidates = narrowed;
		}

		if (!candidates.length) return { state: 'none', candidates: [] };

		// An exact hit wins over moves that merely extend it, so "oo" castles short
		// instead of stalling against "ooo".
		const exact = candidates.filter(m => forms(m).includes(buf));
		if (exact.length === 1) return { state: 'unique', move: exact[0], candidates: exact };

		candidates = collapsePromotions(candidates, preferred);

		if (candidates.length === 1) return { state: 'unique', move: candidates[0], candidates };
		return { state: 'ambiguous', candidates };
	}

	return { canon, forms, match };
});
