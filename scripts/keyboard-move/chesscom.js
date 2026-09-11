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
			// The seat flag has to come off the mode descriptor: the same-named
			// game.usePlayingAs() returns undefined on boards that are certainly
			// seated, which made every board look like an analysis board and let
			// typing through on the opponent's turn.
			const seated = safe(() => g.getMode().usePlayingAs, false);
			if (!seated) return { playable: true, reason: null };

			// getPlayingAs() is also intermittently undefined on a seated board, so
			// fall back to which way the board is facing.
			let playingAs = safe(() => g.getPlayingAs(), null);
			if (playingAs !== 1 && playingAs !== 2) {
				const flipped = safe(() => g.getOptions().flipped, null);
				if (flipped === true) playingAs = 2;
				else if (flipped === false) playingAs = 1;
				else return { playable: false, reason: 'no seat' };
			}

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
		// Play the move, then confirm it actually landed before reporting success.
		//
		// Each form is checked after yielding to the event loop, never in the same
		// block as the call: chess.com applies a move on the next tick, so a
		// same-tick read always sees the old position. An earlier version got this
		// wrong and fired a second move() for every single move.
		//
		// userGenerated marks this as a player's move rather than programmatic
		// replay - captured from what the board itself passes when you click a
		// piece. It is tried first because some modes ignore a move without it, and
		// the plainer forms follow in case a mode rejects the flag.
		async play(move) {
			const g = game();
			if (!g) return false;
			const base = { from: move.from, to: move.to, promotion: move.promotion };
			const forms = [
				{ ...base, userGenerated: true },
				base,
				move.san,
			];
			for (const form of forms) {
				const before = safe(() => g.getFEN(), null);
				safe(() => g.move(form));
				await new Promise(r => setTimeout(r, 80));
				const after = safe(() => g.getFEN(), null);
				if (after !== null && after !== before) return true;
			}
			return false;
		},

		fen() {
			const g = game();
			return g ? safe(() => g.getFEN(), null) : null;
		},
	};
})();
