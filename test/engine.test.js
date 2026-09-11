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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
