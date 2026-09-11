// Chessable adapter, for the explore board.
//
// The board lives in a same-origin iframe (/mt1/explore/...), and this script
// runs inside it, so the page's own globals are simply on globalThis: `game` is
// a chess.js instance, `board` is chessboard.js, and `onDrop` is the handler a
// drag would have called.
//
// Moves go through onDrop rather than game.move(), because onDrop is what
// updates Chessable's own state - the move list, the FEN box, and the opening
// explorer's query for the new position. game.move() alone advances the
// position while leaving all of that behind.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});

	function safe(fn, fallback) {
		try { return fn(); } catch (e) { return fallback; }
	}

	// The app's globals, or null if this frame is not the board.
	function app() {
		const w = globalThis;
		return (w.game && w.board && typeof w.onDrop === 'function') ? w : null;
	}

	let cache = { fen: null, moves: [] };

	function movesFromFen(fen) {
		if (cache.fen === fen) return cache.moves;
		let moves = [];
		try {
			moves = new ns.Chess(fen).moves({ verbose: true }).map(m => ({
				san: m.san, from: m.from, to: m.to, promotion: m.promotion,
				// chessboard.js piece code, e.g. "wP" - onDrop expects one.
				code: m.color + m.piece.toUpperCase(),
			}));
		} catch (e) {
			moves = [];
		}
		cache = { fen, moves };
		return moves;
	}

	ns.chessable = {
		name: 'chessable',

		isReady() {
			return !!app() && !!ns.Chess;
		},

		legalMoves() {
			const w = app();
			if (!w) return [];
			const fen = safe(() => w.game.fen(), null);
			return fen ? movesFromFen(fen) : [];
		},

		// An explore board has no seat: both colours are yours to move.
		status() {
			return app() ? { playable: true, reason: null } : { playable: false, reason: 'no board' };
		},

		isMyTurn() {
			return this.status().playable;
		},

		async play(move) {
			const w = app();
			if (!w) return false;
			const before = safe(() => w.game.fen(), null);
			if (!safe(() => { w.onDrop(move.from, move.to, move.code); return true; }, false)) {
				return false;
			}
			// onDrop advances the game but leaves the pieces where they were: the
			// redraw normally happens in onSnapEnd, at the end of a drag that never
			// took place here. Calling onSnapEnd does not do it, so set the position.
			safe(() => w.board.position(w.game.fen()));
			await new Promise(r => setTimeout(r, 60));
			return safe(() => w.game.fen(), null) !== before;
		},

		back() { const w = app(); return w ? safe(() => { w.showPrevMove(); return true; }, false) : false; },
		forward() { const w = app(); return w ? safe(() => { w.showNextMove(); return true; }, false) : false; },
		toStart() { const w = app(); return w ? safe(() => { w.showFirstMove(); return true; }, false) : false; },
		toEnd() { const w = app(); return w ? safe(() => { w.showLastMove(); return true; }, false) : false; },

		// No takeback here. game.undo() would roll back the position while leaving
		// Chessable's move list and explorer showing the move, and there is no
		// app-level retract to call instead. Stepping back with the arrows is the
		// honest equivalent on an explore board.
		canUndo() { return false; },
		undo() { return false; },

		// An explore board has no opponent, so there is nothing to premove against.
		premoveMoves() { return []; },
		premove() { return false; },
		cancelPremove() { return false; },
		premoveQueue() { return []; },

		fen() {
			const w = app();
			return w ? safe(() => w.game.fen(), null) : null;
		},
	};

	(ns.adapters = ns.adapters || []).push(ns.chessable);
})();
