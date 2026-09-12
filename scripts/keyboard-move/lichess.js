// lichess adapter.
//
// Analysis and study boards expose their controller as site.analysis, which is
// what makes them straightforward: userMove(orig, dest) is the same entry point
// a drag reaches. Game pages expose no controller at all - site.round does not
// exist and nothing is attached to the DOM - and chessground refuses synthetic
// mouse events, so the only way in there is lichess's own keyboard-move box.
// That has to be switched on in lichess preferences; without it, a game board
// reports itself unplayable rather than pretending.
//
// The keyboard-move transport is UNVERIFIED. Driving that box with synthetic
// events on an analysis board did nothing, through four different combinations:
// setting value then Enter as keydown, as keypress, as keyup, and typing
// character by character with a full event set each. Synthetic mouse events on
// chessground are refused the same way. The likeliest explanation is an
// isTrusted check, which is what chessground does for drags - but that could not
// be confirmed, since redefining Event.prototype.isTrusted had no effect from
// the console either. A real content script at document_start may fare better.
// Until someone tries it in a game, expect analysis boards to work and game
// boards to report the move as not accepted.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});

	function safe(fn, fallback) {
		try { return fn(); } catch (e) { return fallback; }
	}

	function analysis() {
		return safe(() => window.site && window.site.analysis, null);
	}

	function ground() {
		const an = analysis();
		if (an && an.chessground) return an.chessground;
		return null;
	}

	function keyboardBox() {
		const el = document.querySelector('.keyboard-move input');
		return el && !el.disabled ? el : null;
	}

	// Castling rights are not in chessground's placement-only FEN, so they are
	// deduced from where the kings and rooks stand. Wrong only in the case where
	// a piece has returned to its home square after moving, and the dests filter
	// below removes any castle that is not actually available.
	function castling(placement) {
		const rows = placement.split('/');
		const expand = r => r.replace(/\d/g, d => '.'.repeat(Number(d)));
		const back = expand(rows[7] || ''), front = expand(rows[0] || '');
		let out = '';
		if (back[4] === 'K' && back[7] === 'R') out += 'K';
		if (back[4] === 'K' && back[0] === 'R') out += 'Q';
		if (front[4] === 'k' && front[7] === 'r') out += 'k';
		if (front[4] === 'k' && front[0] === 'r') out += 'q';
		return out || '-';
	}

	function fullFen() {
		// Analysis boards publish the real thing, including halfmove counters.
		const shown = safe(() => document.querySelector('.copyables .fen input, input.copyable'), null);
		if (shown && shown.value && shown.value.split(' ').length >= 4) return shown.value;

		const cg = ground();
		if (!cg) return null;
		const placement = safe(() => cg.getFen(), null);
		if (!placement) return null;
		const turn = safe(() => cg.state.turnColor, 'white') === 'black' ? 'b' : 'w';
		return placement + ' ' + turn + ' ' + castling(placement) + ' - 0 1';
	}

	let cache = { fen: null, dests: null, moves: [] };

	ns.lichess = {
		name: 'lichess',
		supportsPremove: false,

		isReady() {
			return !!ground() && !!ns.Chess;
		},

		// Generated locally for the SAN, then filtered against chessground's own
		// dests, which is lichess's legality rather than ours. That combination
		// covers the deduced castling rights being wrong.
		legalMoves() {
			const cg = ground();
			if (!cg) return [];
			const fen = fullFen();
			if (!fen) return [];
			const dests = safe(() => cg.state.movable.dests, null);
			const key = fen + '|' + (dests ? dests.size : 0);
			if (cache.fen === key) return cache.moves;

			let moves = [];
			try {
				moves = new ns.Chess(fen).moves({ verbose: true }).map(m => ({
					san: m.san, from: m.from, to: m.to, promotion: m.promotion,
				}));
			} catch (e) {
				moves = [];
			}
			if (dests && dests.size) {
				moves = moves.filter(m => (dests.get(m.from) || []).includes(m.to));
			}
			cache = { fen: key, dests, moves };
			return moves;
		},

		status() {
			const cg = ground();
			if (!cg) return { playable: false, reason: 'no board' };
			if (safe(() => cg.state.viewOnly, false)) return { playable: false, reason: 'observing' };

			// A game board with no controller and no keyboard box cannot be played
			// by anything we have.
			if (!analysis() && !keyboardBox()) {
				return { playable: false, reason: 'enable keyboard input in lichess preferences' };
			}

			const movable = safe(() => cg.state.movable.color, null);
			if (!movable || movable === 'both') return { playable: true, reason: null };
			const turn = safe(() => cg.state.turnColor, null);
			if (turn && movable !== turn) return { playable: false, reason: 'not your turn' };
			return { playable: true, reason: null };
		},

		isMyTurn() { return this.status().playable; },

		async play(move) {
			const cg = ground();
			if (!cg) return false;
			const before = safe(() => cg.getFen(), null);

			const an = analysis();
			if (an && typeof an.userMove === 'function') {
				safe(() => an.userMove(move.from, move.to, move.promotion));
			} else {
				const box = keyboardBox();
				if (!box) return false;
				// Hand lichess the move in its own input, in UCI so there is nothing
				// to disambiguate, and submit the way a player would.
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype, 'value').set;
				setter.call(box, move.from + move.to + (move.promotion || ''));
				box.dispatchEvent(new Event('input', { bubbles: true }));
				for (const type of ['keydown', 'keyup']) {
					box.dispatchEvent(new KeyboardEvent(type, {
						key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
						bubbles: true, cancelable: true,
					}));
				}
			}

			await new Promise(r => setTimeout(r, 120));
			return safe(() => cg.getFen(), null) !== before;
		},

		// lichess binds the arrow keys itself, and does it well. Returning false
		// leaves the keypress alone so its own navigation runs.
		back() { return false; },
		forward() { return false; },
		toStart() { return false; },
		toEnd() { return false; },
		canUndo() { return false; },
		undo() { return false; },
		premoveMoves() { return []; },
		premove() { return false; },
		cancelPremove() { return false; },
		premoveQueue() { return []; },

		fen() { return fullFen(); },
	};

	(ns.adapters = ns.adapters || []).push(ns.lichess);
})();
