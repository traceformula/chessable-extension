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

		// Piece moves accept any disambiguator that identifies the origin square,
		// not just the one SAN happens to use. With rooks on g8 and b6 both able to
		// take on g6, SAN picks the file and writes "Rgxg6", but "the rook on the
		// 8th rank" is just as unambiguous to a person - so "R8xg6" and the fully
		// explicit "Rg8xg6" resolve too. Dropping the disambiguator entirely is
		// allowed as well, which leaves the matcher to report the tie.
		//
		// Pawn moves are excluded throughout: stripping the file from "exd5" would
		// collide with the unrelated pawn push "d5".
		// Read the piece letter off the original SAN, where case still separates a
		// piece from a file. canon() has lowercased by this point, so testing it
		// would count the b-file pawn move "b5" as a bishop move and hand it
		// bishop-style origin forms - giving "b5" the spelling "bb5", which then
		// collides with a real bishop move to the b-file.
		const piece = /^[NBRQK]/.test(move.san || '') ? c[0] : null;
		if (piece && move.from && move.to) {
			const cap = c.includes('x') ? 'x' : '';
			const from = canon(move.from);
			const to = canon(move.to);
			const tail = c.slice(c.indexOf(to) + to.length); // promotion, if any
			for (const hint of ['', from[0], from[1], from]) {
				out.add(piece + hint + cap + to + tail);
				if (cap) out.add(piece + hint + to + tail);
			}
		}

		if (move.from && move.to) {
			const uci = canon(move.from + move.to);
			out.add(uci);
			if (move.promotion) out.add(uci + canon(move.promotion));
			// "b6xc5" for a capture, matching the x that SAN and the piece forms
			// above both accept. Pawns get no shorter origin hint than this: unlike
			// a piece move, dropping the rank from "exd5" would leave "d5", which is
			// a different, legal pawn push.
			if (c.includes('x')) out.add(canon(move.from) + 'x' + canon(move.to));
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

		// Case is the one thing notation already uses to tell these apart, and b is
		// the only letter that is both a piece and a file. "Bxc5" is the bishop,
		// "bxc5" the b-pawn - but canon() has lowercased by here, so both arrive as
		// the same string and neither could be reached without this.
		//
		// Either way it only narrows when something is left, so typing lowercase
		// for a piece still works wherever there is no pawn move to confuse it
		// with: "bb5" finds Bb5, because no pawn move is spelled that way.
		const lead = raw[0];
		if (PIECES.includes(lead)) {
			const narrowed = candidates.filter(m => (m.san || '')[0] === lead);
			if (narrowed.length) candidates = narrowed;
		} else if (/^[a-h]$/.test(lead)) {
			const narrowed = candidates.filter(m => /^[a-h]/.test(m.san || ''));
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

	// Whether the input names a destination square outright, rather than stopping
	// part-way through one.
	//
	// Auto-play must wait for this. "bd" can be the only legal move beginning
	// those letters while the player is still typing "bd6", and committing on the
	// bare file plays some other bishop move instead of reporting that the move
	// they wanted was never legal. A wrong move is far worse than a refusal.
	function isComplete(raw) {
		const c = canon(raw);
		if (c === 'oo' || c === 'ooo') return true;       // castling names no square
		if (/[a-h][1-8]$/.test(c)) return true;
		return /[a-h][1-8][qrbn]$/.test(c);               // promotion piece trails it
	}

	// Whether some other legal move could still grow out of what has been typed.
	//
	// "oo" resolves to O-O, but O-O-O is one keystroke further on, so committing
	// on "oo" castles the wrong way for anyone typing "ooo". Moves sharing the
	// chosen move's from/to do not count - those are only the promotion choices,
	// and the default has already been picked.
	function isExtendable(raw, chosen, moves) {
		const buf = canon(raw);
		return moves.some(m => forms(m).some(f => {
			if (f.length <= buf.length || !f.startsWith(buf)) return false;
			// The one extension that does not count is a promotion piece on the
			// move already chosen: "e8" should play e8=Q rather than wait for a
			// letter. Anything else does count, including a longer spelling of the
			// same move - "b6" is a prefix of the UCI form "b6b5", so typing the
			// illegal "b6" must not quietly play b5.
			const samePlace = m.from === chosen.from && m.to === chosen.to;
			return !(samePlace && /^[qrbn]$/.test(f.slice(buf.length)));
		}));
	}

	return { canon, forms, match, isComplete, isExtendable };
});
