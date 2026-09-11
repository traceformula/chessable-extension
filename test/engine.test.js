// The chess.com move list proved unreliable, so legal moves are generated from
// the board FEN instead. These pin that the vendored engine answers correctly for
// the exact positions that broke on the live site.
const assert = require('assert');
globalThis.__KBM = {};
require('../scripts/keyboard-move/vendor/chess.js');
const Chess = globalThis.__KBM.Chess;
const { match } = require('../scripts/keyboard-move/matcher.js');

let passed = 0, failed = 0;
function test(name, fn) {
	try { fn(); passed++; }
	catch (e) { failed++; console.error('FAIL  ' + name + '\n      ' + e.message); }
}
const { forms } = require('../scripts/keyboard-move/matcher.js');
const legal = fen => new Chess(fen).moves({ verbose: true })
	.map(m => ({ san: m.san, from: m.from, to: m.to, promotion: m.promotion }));

test('vendored chess.js loads as a classic script', () => {
	assert.strictEqual(typeof Chess, 'function');
});

test('start position yields 20 moves, not chess.com\'s 106', () => {
	const moves = legal('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
	assert.strictEqual(moves.length, 20);
	assert.ok(moves.some(m => m.san === 'd4'));
});

test('typing d4 on the /play/computer start position resolves', () => {
	// The live failure: chess.com served 106 black moves here and "d4" reported
	// "no such move" even though the engine accepted d2d4.
	const moves = legal('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
	const r = match('d4', moves);
	assert.strictEqual(r.state, 'unique');
	assert.strictEqual(r.move.from, 'd2');
	assert.strictEqual(r.move.to, 'd4');
});

test('generated moves carry the fields the matcher needs', () => {
	const m = legal('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
		.find(x => x.san === 'Nf3');
	assert.deepStrictEqual({ san: m.san, from: m.from, to: m.to }, { san: 'Nf3', from: 'g1', to: 'f3' });
});

test('promotions arrive with a promotion field', () => {
	const moves = legal('8/4P3/8/8/8/8/8/K6k w - - 0 1');
	const promos = moves.filter(m => m.to === 'e8');
	assert.strictEqual(promos.length, 4);
	assert.ok(promos.every(m => m.promotion));
	assert.strictEqual(match('e8', moves).move.san, 'e8=Q');
});

test('castling is generated and typeable as oo', () => {
	const moves = legal('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
	assert.ok(moves.some(m => m.san === 'O-O'));
	assert.strictEqual(match('oo', moves).move.san, 'O-O');
	assert.strictEqual(match('ooo', moves).move.san, 'O-O-O');
});

test('disambiguation is generated correctly for two knights', () => {
	const moves = legal('8/8/8/8/8/8/8/1N1k1N1K w - - 0 1');
	const sans = moves.map(m => m.san);
	assert.ok(sans.includes('Nbd2') && sans.includes('Nfd2'), sans.join(','));
	assert.strictEqual(match('nd2', moves).state, 'ambiguous');
	assert.strictEqual(match('nbd2', moves).move.san, 'Nbd2');
});

test('pins are respected, so an illegal SAN is not offered', () => {
	// Knight on e2 is pinned to the king on e1 by the rook on e8.
	const moves = legal('4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1');
	assert.ok(!moves.some(m => m.from === 'e2'), 'pinned knight must not move');
	assert.strictEqual(match('nd4', moves).state, 'none');
});

// Replays the commit rule exactly as main.js applies it.
const { isComplete, isExtendable } = require('../scripts/keyboard-move/matcher.js');
function typeOut(text, moves) {
	let buffer = '', played = null, rejected = null;
	for (const ch of text) {
		const next = buffer + ch;
		const r = match(next, moves);
		if (r.state === 'none') { rejected = next; break; }
		buffer = next;
		if (r.state === 'unique' && buffer.length >= 2 && isComplete(buffer) &&
				!isExtendable(buffer, r.move, moves)) {
			played = r.move.san;
			break;
		}
	}
	return { played, rejected, buffer };
}

test('a half-typed square never commits a different move', () => {
	// From a real game: white to move, no bishop can reach d6, but "bd" is the
	// only move starting with those letters. Typing "bd6" used to play Bd2.
	const moves = legal('r1bq1rk1/p2n1ppp/1ppb1n2/3pp3/4P3/2PP1NP1/PPQ2PBP/RNB2RK1 w - - 0 9');
	assert.strictEqual(match('bd', moves).move.san, 'Bd2', 'still resolves, just must not fire');
	const r = typeOut('bd6', moves);
	assert.strictEqual(r.played, null, 'played ' + r.played + ' instead of refusing');
	assert.strictEqual(r.rejected, 'bd6');
});

test('typing a legal bishop move still works', () => {
	const moves = legal('r1bq1rk1/p2n1ppp/1ppb1n2/3pp3/4P3/2PP1NP1/PPQ2PBP/RNB2RK1 w - - 0 9');
	assert.strictEqual(typeOut('bd2', moves).played, 'Bd2');
	assert.strictEqual(typeOut('bg5', moves).played, 'Bg5');
});

test('pawn moves still commit in two keystrokes', () => {
	const moves = legal('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
	const r = typeOut('e4', moves);
	assert.strictEqual(r.played, 'e4');
	assert.strictEqual(r.buffer, 'e4');
});

test('piece moves now need the whole destination square', () => {
	const moves = legal('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
	// "nf" resolves uniquely to Nf3 but must wait for the rank.
	assert.strictEqual(match('nf', moves).move.san, 'Nf3');
	assert.strictEqual(typeOut('nf', moves).played, null);
	assert.strictEqual(typeOut('nf3', moves).played, 'Nf3');
});

test('typing ooo does not castle short on the way', () => {
	// Both castles legal: "oo" resolves to O-O but O-O-O is one key further on,
	// so it has to wait rather than fire.
	const moves = legal('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
	assert.strictEqual(match('oo', moves).move.san, 'O-O', 'still resolves');
	assert.strictEqual(typeOut('oo', moves).played, null, 'must not fire yet');
	assert.strictEqual(typeOut('ooo', moves).played, 'O-O-O');
});

test('castling commits at once when only one castle is legal', () => {
	const moves = legal('r3k3/8/8/8/8/8/8/4K2R w Kk - 0 1');
	assert.strictEqual(typeOut('oo', moves).played, 'O-O');
});

test('promotion still defaults to queen without waiting', () => {
	// The only moves extending "e8" are the other promotion pieces, which share
	// a from/to with the chosen move, so they must not hold it up.
	const moves = legal('8/4P3/8/8/8/8/8/K6k w - - 0 1');
	assert.strictEqual(typeOut('e8', moves).played, 'e8=Q');
});

test('a b-file pawn move is not mistaken for a bishop move', () => {
	// canon() lowercases, so "b5" and "Bb7" both begin with b. Reading the piece
	// letter off the canonical form gave the pawn bishop-style spellings such as
	// "bb5", which then collided with a real bishop move to the b-file.
	const moves = legal('rnbqkbnr/p1pppppp/1p6/8/8/1P6/P1PPPPPP/RNBQKBNR b KQkq - 0 2');
	const pawn = moves.find(m => m.san === 'b5');
	assert.ok(!forms(pawn).includes('bb5'), forms(pawn).join(' '));
	const r = match('bb', moves);
	assert.strictEqual(r.state, 'unique');
	assert.strictEqual(r.move.san, 'Bb7');
	assert.strictEqual(typeOut('bb7', moves).played, 'Bb7');
	assert.strictEqual(typeOut('b5', moves).played, 'b5');
});

test('an origin square does not commit the move that starts there', () => {
	// "b6" is not a legal move, but it prefixes the UCI spelling "b6b5".
	const moves = legal('rnbqkbnr/p1pppppp/1p6/8/8/1P6/P1PPPPPP/RNBQKBNR b KQkq - 0 2');
	assert.strictEqual(typeOut('b6', moves).played, null);
	assert.strictEqual(typeOut('b6b5', moves).played, 'b5');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
