// lichess adapter.
//
// Two completely different boards live behind one hostname.
//
// Analysis and study boards expose their controller as site.analysis, so
// userMove(orig, dest) reaches the same entry point a drag does. Easy.
//
// Game boards expose nothing: no site.round, no controller on the DOM, and
// chessground refuses synthetic mouse events. Every DOM-level route was tried
// and refused. But the page still has to tell the server about the move, and it
// does that over a WebSocket - so that is where we join in. Wrapping the
// constructor at document_start, before lichess opens it, gives us the same
// socket the page uses, and a move is the frame lichess itself sends:
//
//     {"t":"move","d":{"u":"e2e4"}}
//
// The server answers to the socket, not to whoever called it, so the move comes
// back down the wire and lichess's own code applies it to the board. Nothing is
// faked and nothing is driven through the UI.
//
// Only a /play/ socket is a game we are sitting at - spectating opens /watch/ -
// so a board we are merely watching can never be moved on.
//
// Position comes off the DOM, since no controller will tell us: chessground
// places pieces on an eighth-of-the-board grid, and .cg-wrap carries the
// orientation. Whose turn it is comes from the running clock, and which side we
// are from the player box carrying our own username - read that way rather than
// from the orientation so that flipping the board cannot mislead it.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});

	function safe(fn, fallback) {
		try { return fn(); } catch (e) { return fallback; }
	}

	const sleep = ms => new Promise(r => setTimeout(r, ms));

	// ---------------------------------------------------------------- sockets

	const sockets = [];
	let lastUci = null;
	let lastPly = null;

	function onFrame(ev) {
		const msg = safe(() => JSON.parse(ev.data), null);   // pings are not JSON
		if (!msg || msg.t !== 'move' || !msg.d) return;
		if (msg.d.uci) lastUci = msg.d.uci;
		if (typeof msg.d.ply === 'number') lastPly = msg.d.ply;
	}

	// Transparent: a Proxy keeps instanceof, the static constants and the
	// prototype intact, so lichess cannot tell the difference.
	function hookSockets() {
		const Original = safe(() => window.WebSocket, null);
		if (!Original || Original.__kbmHooked) return;
		const wrapped = new Proxy(Original, {
			construct(target, args) {
				const ws = Reflect.construct(target, args);
				safe(() => {
					// Host as well as path. Matching the path alone would let any
					// script already on the page open a socket of its own ending in
					// /play/ and collect the next move we send.
					const at = new URL(ws.url);
					if (/(^|\.)lichess\.org$/.test(at.hostname) && /\/play\//.test(at.pathname)) {
						sockets.push(ws);
						ws.addEventListener('message', onFrame);
					}
				});
				return ws;
			},
		});
		safe(() => { Original.__kbmHooked = true; });
		safe(() => { window.WebSocket = wrapped; });
	}
	hookSockets();

	function playSocket() {
		for (let i = sockets.length - 1; i >= 0; i--) {
			if (sockets[i].readyState === 1) return sockets[i];   // OPEN
		}
		return null;
	}

	// ------------------------------------------------------------ the boards

	function analysis() {
		return safe(() => window.site && window.site.analysis, null);
	}

	function ground() {
		const an = analysis();
		return an && an.chessground ? an.chessground : null;
	}

	function mode() {
		if (analysis()) return 'analysis';
		if (document.querySelector('.round__app')) return 'round';
		return null;
	}

	const ROLES = {
		pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k',
	};

	// Placement read off the rendered pieces. Pieces mid-animation carry
	// fractional offsets, which round to the square they are heading for, and
	// the dragged and captured copies are skipped so they cannot double up.
	function domPlacement() {
		// Chessground rebuilds these on a flip, and a measurement taken during
		// that reports zero - which would put every piece on the same square. Ask
		// each of them and take the first that answers with a real width.
		let size = 0;
		for (const sel of ['cg-board', 'cg-container', '.cg-wrap']) {
			for (const el of document.querySelectorAll(sel)) {
				size = el.getBoundingClientRect().width;
				if (size) break;
			}
			if (size) break;
		}
		if (!size) return null;
		const unit = size / 8;
		const flipped = !!document.querySelector('.cg-wrap.orientation-black');

		const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
		for (const piece of document.querySelectorAll('cg-board piece')) {
			if (piece.classList.contains('ghost') || piece.classList.contains('fading')) continue;
			const at = /translate\(\s*([-\d.]+)px[,\s]+([-\d.]+)px/
				.exec(piece.getAttribute('style') || '');
			if (!at) continue;
			const col = Math.round(Number(at[1]) / unit);
			const row = Math.round(Number(at[2]) / unit);
			if (col < 0 || col > 7 || row < 0 || row > 7) continue;

			const names = String(piece.className).split(/\s+/);
			const role = names.find(n => ROLES[n]);
			if (!role) continue;
			const white = names.includes('white');
			const file = flipped ? 7 - col : col;
			const rank = flipped ? row : 7 - row;          // 0 is rank 1
			grid[rank][file] = white ? ROLES[role].toUpperCase() : ROLES[role];
		}

		const rows = [];
		for (let rank = 7; rank >= 0; rank--) {
			let row = '', gap = 0;
			for (let file = 0; file < 8; file++) {
				const piece = grid[rank][file];
				if (piece) { if (gap) { row += gap; gap = 0; } row += piece; }
				else gap++;
			}
			if (gap) row += gap;
			rows.push(row);
		}
		return rows.join('/');
	}

	const START_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

	// Three sources, best first. The clock is the plain answer while one is
	// ticking, but it is not always: a correspondence game has none, and neither
	// side's clock runs before the opening move. The server numbers every move
	// it sends, and that parity is just as good - ply 1 is white's first move,
	// so an odd count leaves black to play. Failing both, an untouched board can
	// only be white to move.
	// lichess writes the result into the move list the moment a game ends, on the
	// round page as well as the analysis one.
	function gameOver() {
		for (const el of document.querySelectorAll('.result-wrap .status, .status, .result')) {
			if (el.textContent && el.textContent.trim()) return true;
		}
		return false;
	}

	function domTurn() {
		const running = document.querySelector('.rclock.running');
		if (running) return running.classList.contains('rclock-white') ? 'w' : 'b';
		if (lastPly !== null) return lastPly % 2 ? 'b' : 'w';
		if (domPlacement() === START_PLACEMENT) return 'w';
		return null;
	}

	// Which side we are sitting at. The player boxes and the clocks move
	// together when the board is flipped, so pairing them by position holds.
	function myColour() {
		const tag = document.querySelector('#user_tag');
		const me = tag ? tag.textContent.trim().toLowerCase() : '';
		if (me) {
			for (const side of ['bottom', 'top']) {
				const box = document.querySelector('.ruser-' + side);
				const clock = document.querySelector('.rclock-' + side);
				if (box && clock && box.textContent.toLowerCase().includes(me)) {
					return clock.classList.contains('rclock-white') ? 'w' : 'b';
				}
			}
		}
		return document.querySelector('.cg-wrap.orientation-black') ? 'b' : 'w';
	}

	// Castling rights are not in a placement-only FEN, so they are deduced from
	// where the kings and rooks stand. Wrong only after a piece has returned to
	// its home square, and then the server simply ignores the move rather than
	// playing a different one.
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

	// The one right the placement cannot show. Taken from the move the server
	// last sent us: a pawn that has just crossed two ranks can be taken past.
	function enPassant(placement) {
		if (!lastUci || lastUci.length < 4) return '-';
		const from = lastUci.slice(0, 2), to = lastUci.slice(2, 4);
		if (from[0] !== to[0]) return '-';
		const fromRank = Number(from[1]), toRank = Number(to[1]);
		if (Math.abs(fromRank - toRank) !== 2) return '-';

		const rows = placement.split('/').map(r => r.replace(/\d/g, d => '.'.repeat(Number(d))));
		const landed = rows[8 - toRank] && rows[8 - toRank][from.charCodeAt(0) - 97];
		if (!landed || landed.toLowerCase() !== 'p') return '-';
		return from[0] + ((fromRank + toRank) / 2);
	}

	function roundFen() {
		const placement = domPlacement();
		const turn = domTurn();
		if (!placement || !turn) return null;
		return [placement, turn, castling(placement), enPassant(placement), 0, 1].join(' ');
	}

	function analysisFen() {
		const shown = document.querySelector('.copyables .fen input, input.copyable');
		if (shown && shown.value && shown.value.split(' ').length >= 4) return shown.value;

		const cg = ground();
		if (!cg) return null;
		const placement = safe(() => cg.getFen(), null);
		if (!placement) return null;
		const turn = safe(() => cg.state.turnColor, 'white') === 'black' ? 'b' : 'w';
		return placement + ' ' + turn + ' ' + castling(placement) + ' - 0 1';
	}

	function fullFen() {
		return mode() === 'round' ? roundFen() : analysisFen();
	}

	let cache = { key: null, moves: [] };

	ns.lichess = {
		name: 'lichess',
		supportsPremove: false,

		isReady() {
			return !!mode() && !!ns.Chess;
		},

		// Generated locally for the SAN. On analysis boards chessground's own
		// dests then filter it, which is lichess's legality rather than ours; a
		// game board has no dests to consult, and an illegal move is refused by
		// the server rather than turning into a different one.
		legalMoves() {
			const fen = fullFen();
			if (!fen) return [];
			const cg = ground();
			const dests = cg ? safe(() => cg.state.movable.dests, null) : null;
			const key = fen + '|' + (dests ? dests.size : 0);
			if (cache.key === key) return cache.moves;

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
			cache = { key, moves };
			return moves;
		},

		status() {
			const where = mode();
			if (!where) return { playable: false, reason: 'no board' };

			if (where === 'round') {
				// A finished game still looks playable from the outside: the socket
				// stays open a while and the ply count still names a side to move.
				// Saying so would fire a move at a game the server has closed.
				if (gameOver()) return { playable: false, reason: 'game over - open the analysis board' };
				if (!playSocket()) return { playable: false, reason: 'not your game' };
				const turn = domTurn();
				if (!turn) return { playable: false, reason: 'no clock running' };
				if (turn !== myColour()) return { playable: false, reason: 'not your turn' };
				return { playable: true, reason: null };
			}

			const cg = ground();
			if (!cg) return { playable: false, reason: 'no board' };
			if (safe(() => cg.state.viewOnly, false)) return { playable: false, reason: 'observing' };
			const movable = safe(() => cg.state.movable.color, null);
			if (!movable || movable === 'both') return { playable: true, reason: null };
			const turn = safe(() => cg.state.turnColor, null);
			if (turn && movable !== turn) return { playable: false, reason: 'not your turn' };
			return { playable: true, reason: null };
		},

		isMyTurn() { return this.status().playable; },

		async play(move) {
			const uci = move.from + move.to + (move.promotion || '');

			if (mode() === 'round') {
				const ws = playSocket();
				if (!ws) return false;
				const before = domPlacement();
				safe(() => ws.send(JSON.stringify({ t: 'move', d: { u: uci } })));
				// The move is only real once the server has sent it back and
				// lichess has put it on the board.
				for (let i = 0; i < 15; i++) {
					await sleep(60);
					if (domPlacement() !== before) return true;
				}
				return false;
			}

			const cg = ground();
			const an = analysis();
			if (!cg || !an || typeof an.userMove !== 'function') return false;
			const before = safe(() => cg.getFen(), null);
			safe(() => an.userMove(move.from, move.to, move.promotion));
			await sleep(120);
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
