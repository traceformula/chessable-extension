// chess.com adapter. Runs in the MAIN world so it can reach the game object that
// <wc-chess-board> hangs off its element - the board itself is WebGL, so there is
// no DOM to scrape and this API is the only way in.
//
// Legal moves are generated locally from the board's FEN rather than taken from
// game.getLegalMoves(). That API cannot be trusted: on /play/computer it returns
// a stale list for the wrong colour (106 black moves while the FEN says white to
// move), and getLegalMovesForSquare() returns [] or entries with null SANs on the
// same board. The engine underneath is fine - isLegalMove() and move() both
// behave - so chess.com is used only to execute a move we resolved ourselves.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});

	// Modes where a move would be a lie: the model updates and the board animates,
	// but no move is submitted and the clock keeps running. Deliberately narrow -
	// "analysis" and game review are local-only by design and must stay usable.
	const READ_ONLY_MODE = /observ|spectat/i;

	function board() {
		return document.querySelector('wc-chess-board');
	}

	// chess.com ships its own keystroke capture (the board option captureKeyStrokes,
	// on by default). Leaving it enabled means two handlers race for the same keys.
	// We turn it off once per board element, re-applying after SPA navigation swaps
	// the board out.
	let claimed = null;

	function game() {
		const b = board();
		if (!b || !b.game) return null;
		if (claimed !== b) {
			claimed = b;
			try {
				if (b.game.getOptions().captureKeyStrokes) {
					b.game.setOptions({ captureKeyStrokes: false });
				}
			} catch (e) { /* option gone: nothing to claim */ }
		}
		return b.game;
	}

	// Undocumented API, so every call is guarded: a chess.com refactor should
	// degrade to "keyboard input unavailable" rather than throw on every keypress.
	function safe(fn, fallback) {
		try { return fn(); } catch (e) { return fallback; }
	}

	let cache = { fen: null, moves: [] };

	function movesFromFen(fen) {
		if (cache.fen === fen) return cache.moves;
		let moves = [];
		try {
			const c = new ns.Chess(fen);
			moves = c.moves({ verbose: true }).map(m => ({
				san: m.san, from: m.from, to: m.to, promotion: m.promotion, after: m.after,
			}));
		} catch (e) {
			moves = [];
		}
		cache = { fen, moves };
		return moves;
	}

	ns.chesscom = {
		name: 'chess.com',

		isReady() {
			return !!game() && !!ns.Chess;
		},

		legalMoves() {
			const g = game();
			if (!g) return [];
			const fen = safe(() => g.getFEN(), null);
			return fen ? movesFromFen(fen) : [];
		},

		// Whether a move typed right now would actually count.
		//
		// The trap is "observing" mode, which chess.com uses for a game you have
		// open but are not seated at. Its move() still mutates the model and
		// animates the board, so a move looks played while the server never hears
		// about it and your clock keeps running. Anything that is not a live seat
		// has to be refused rather than silently faked.
		status() {
			const g = game();
			if (!g) return { playable: false, reason: 'no board' };

			const name = safe(() => g.getMode().name, null);
			if (name && READ_ONLY_MODE.test(name)) return { playable: false, reason: name };

			// Analysis-style boards have no seat and let you move both colours.
			const seated = safe(() =>
				typeof g.usePlayingAs === 'function' ? g.usePlayingAs() : !!g.usePlayingAs, false);
			if (!seated) return { playable: true, reason: null };

			const playingAs = safe(() => g.getPlayingAs(), null);
			if (playingAs !== 1 && playingAs !== 2) return { playable: false, reason: 'no seat' };

			// Side to move comes from the FEN, which stayed correct on every board
			// where getLegalMoves() did not.
			const field = String(safe(() => g.getFEN(), '')).split(' ')[1];
			if (field !== 'w' && field !== 'b') return { playable: false, reason: 'no position' };
			if ((field === 'b' ? 2 : 1) !== playingAs) {
				return { playable: false, reason: 'not your turn' };
			}
			return { playable: true, reason: null };
		},

		isMyTurn() {
			return this.status().playable;
		},

		// Moves now come from chess.js, so they are handed over as plain
		// from/to/promotion. The SAN string is kept as a fallback because chess.com
		// accepts that form too.
		//
		// userGenerated marks this as a player's move rather than programmatic
		// replay. Captured from what the board itself passes when you click a
		// piece: move({from, to, san, userGenerated: true, ...}). Without it the
		// move still lands in the model and animates, but the surrounding mode
		// plugin treats it as a replayed move - which is how a move can appear on
		// the board while the server never hears about it.
		// Exactly one move() call per typed move. An earlier version verified the
		// call by diffing the FEN and retried when it had not changed - but
		// chess.com applies a move asynchronously, so that check fired before the
		// position updated and issued a second move() for the same input. Falling
		// back is therefore only safe when the first call actually threw.
		play(move) {
			const g = game();
			if (!g) return false;
			const ok = safe(() => {
				g.move({
					from: move.from, to: move.to, promotion: move.promotion, userGenerated: true,
				});
				return true;
			}, false);
			if (ok) return true;
			return safe(() => { g.move(move.san); return true; }, false);
		},

		// Asynchronous confirmation, for reporting only - never for retrying.
		//
		// Polls instead of sampling once: chess.com applies a move through an
		// animation whose length depends on the user's board settings, so a single
		// check on a timer reports good moves as failures. Success is "our move is
		// now the last move", with a changed position as a second signal for when
		// the opponent has already replied on top of it.
		confirm(move, fenBefore, timeoutMs) {
			const g = game();
			if (!g) return Promise.resolve(true);
			const deadline = Date.now() + (timeoutMs || 2500);
			return new Promise(resolve => {
				const poll = () => {
					const last = safe(() => g.getLastMove(), null);
					if (last && last.from === move.from && last.to === move.to) return resolve(true);
					if (safe(() => g.getFEN(), fenBefore) !== fenBefore) return resolve(true);
					if (Date.now() >= deadline) return resolve(false);
					setTimeout(poll, 100);
				};
				setTimeout(poll, 100);
			});
		},

		fen() {
			const g = game();
			return g ? safe(() => g.getFEN(), null) : null;
		},
	};
})();
