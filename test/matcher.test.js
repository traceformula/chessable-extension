const assert = require('assert');
const { match, canon } = require('../scripts/keyboard-move/matcher.js');

let passed = 0, failed = 0;
function test(name, fn) {
	try { fn(); passed++; }
	catch (e) { failed++; console.error('FAIL  ' + name + '\n      ' + e.message); }
}
const mv = (san, from, to, promotion) => ({ san, from, to, promotion });

// White's 20 opening moves.
const START = [
	mv('a3','a2','a3'), mv('a4','a2','a4'), mv('b3','b2','b3'), mv('b4','b2','b4'),
	mv('c3','c2','c3'), mv('c4','c2','c4'), mv('d3','d2','d3'), mv('d4','d2','d4'),
	mv('e3','e2','e3'), mv('e4','e2','e4'), mv('f3','f2','f3'), mv('f4','f2','f4'),
	mv('g3','g2','g3'), mv('g4','g2','g4'), mv('h3','h2','h3'), mv('h4','h2','h4'),
	mv('Na3','b1','a3'), mv('Nc3','b1','c3'), mv('Nf3','g1','f3'), mv('Nh3','g1','h3'),
];

test('prefix-unique pawn move commits at two keystrokes', () => {
	const r = match('e4', START);
	assert.strictEqual(r.state, 'unique');
	assert.strictEqual(r.move.san, 'e4');
});

test('bare piece letter stays ambiguous', () => {
	assert.strictEqual(match('N', START).state, 'ambiguous');
	assert.strictEqual(match('N', START).candidates.length, 4);
});

test('piece + file resolves before the rank is typed', () => {
	const r = match('Nf', START);
	assert.strictEqual(r.state, 'unique');
	assert.strictEqual(r.move.san, 'Nf3');
});

test('case is irrelevant for unambiguous piece letters', () => {
	for (const s of ['nf3', 'Nf3', 'NF3', 'nF3']) {
		assert.strictEqual(match(s, START).move.san, 'Nf3', s);
	}
});

test('unknown input reports none rather than guessing', () => {
	assert.strictEqual(match('zz', START).state, 'none');
	assert.strictEqual(match('e5', START).state, 'none');
});

test('UCI is accepted alongside SAN', () => {
	assert.strictEqual(match('e2e4', START).move.san, 'e4');
	assert.strictEqual(match('g1f3', START).move.san, 'Nf3');
});

// The genuine collision: bishop-to-c4 vs b-pawn-takes-c4 both fold to "bc4".
const BISHOP_VS_BPAWN = [
	mv('Bc4','f1','c4'), mv('bxc4','b3','c4'), mv('Nf3','g1','f3'),
];

// Changed deliberately: this used to report the tie and play nothing. On a board
// where the bishop capture is also a capture ("Bxc5" vs "bxc5") the x separates
// nothing, so the pawn move had no spelling at all and the input simply died.
// SAN already answers this - lowercase b is the file - so case decides.
test('lowercase bc4 reads as the b-pawn, since SAN spells the bishop with B', () => {
	const r = match('bc4', BISHOP_VS_BPAWN);
	assert.strictEqual(r.state, 'unique');
	assert.strictEqual(r.move.san, 'bxc4');
});

test('uppercase B disambiguates to the bishop', () => {
	const r = match('Bc4', BISHOP_VS_BPAWN);
	assert.strictEqual(r.state, 'unique');
	assert.strictEqual(r.move.san, 'Bc4');
});

test('typing the x disambiguates to the pawn capture', () => {
	const r = match('bxc4', BISHOP_VS_BPAWN);
	assert.strictEqual(r.state, 'unique');
	assert.strictEqual(r.move.san, 'bxc4');
});

test('captures may be typed without the x', () => {
	assert.strictEqual(match('nxd4', [mv('Nxd4','f3','d4')]).state, 'unique');
	assert.strictEqual(match('nd4',  [mv('Nxd4','f3','d4')]).state, 'unique');
});

const CASTLING = [mv('O-O','e1','g1'), mv('O-O-O','e1','c1'), mv('Nf3','g1','f3')];

test('castling accepts oo, 0-0 and O-O spellings', () => {
	for (const s of ['oo', 'OO', 'O-O', '0-0']) {
		assert.strictEqual(match(s, CASTLING).move.san, 'O-O', s);
	}
	for (const s of ['ooo', 'O-O-O', '0-0-0']) {
		assert.strictEqual(match(s, CASTLING).move.san, 'O-O-O', s);
	}
});

test('single o waits, since it prefixes both castles', () => {
	assert.strictEqual(match('o', CASTLING).state, 'ambiguous');
});

const PROMO = [
	mv('e8=Q','e7','e8','q'), mv('e8=R','e7','e8','r'),
	mv('e8=B','e7','e8','b'), mv('e8=N','e7','e8','n'),
];

test('promotion collapses to queen by default', () => {
	const r = match('e8', PROMO);
	assert.strictEqual(r.state, 'unique');
	assert.strictEqual(r.move.san, 'e8=Q');
});

test('promotion honours an explicit piece', () => {
	assert.strictEqual(match('e8n', PROMO).move.san, 'e8=N');
	assert.strictEqual(match('e8=N', PROMO).move.san, 'e8=N');
});

test('promotion respects a configured preference', () => {
	assert.strictEqual(match('e8', PROMO, { promotion: 'n' }).move.san, 'e8=N');
});

test('check and mate marks are ignored on input and in SAN', () => {
	const moves = [mv('Rb1+','b4','b1'), mv('Qh7#','g7','h7')];
	assert.strictEqual(match('rb1', moves).move.san, 'Rb1+');
	assert.strictEqual(match('rb1+', moves).move.san, 'Rb1+');
	assert.strictEqual(match('qh7#', moves).move.san, 'Qh7#');
});

test('empty buffer is empty, not none', () => {
	assert.strictEqual(match('', START).state, 'empty');
});

test('disambiguated SAN matches the way it is written', () => {
	const moves = [mv('Nbd2','b1','d2'), mv('Nfd2','f3','d2')];
	assert.strictEqual(match('nd2', moves).state, 'ambiguous');
	assert.strictEqual(match('nbd2', moves).move.san, 'Nbd2');
});

// Real position from the chess.com rated puzzle we inspected.
const PUZZLE = [
	mv('Kc6','d5','c6'), mv('Ke6','d5','e6'), mv('Ke5','d5','e5'),
	mv('Kc5','d5','c5'), mv('Rxd2','d1','d2'),
];

test('live puzzle position resolves as expected', () => {
	assert.strictEqual(match('rd2', PUZZLE).move.san, 'Rxd2');
	assert.strictEqual(match('k', PUZZLE).state, 'ambiguous');
	assert.strictEqual(match('kc', PUZZLE).state, 'ambiguous');
	assert.strictEqual(match('kc6', PUZZLE).move.san, 'Kc6');
});

// Rooks on g8 and b6, both able to capture on g6. SAN disambiguates by file
// ("Rgxg6"), but a person may just as reasonably think "the rook on rank 8".
const TWO_ROOKS = [
	mv('Rgxg6','g8','g6'), mv('Rbxg6','b6','g6'),
	mv('Rg7','g8','g7'), mv('Rb7','b6','b7'), mv('Rxb4','b6','b4'),
];

test('any disambiguator that identifies the origin is accepted', () => {
	for (const s of ['rgxg6', 'r8xg6', 'rg8xg6', 'r8g6', 'rgg6']) {
		const r = match(s, TWO_ROOKS);
		assert.strictEqual(r.state, 'unique', s + ' -> ' + r.state);
		assert.strictEqual(r.move.san, 'Rgxg6', s);
	}
});

test('the other rook is reachable by its own file or rank', () => {
	assert.strictEqual(match('rbxg6', TWO_ROOKS).move.san, 'Rbxg6');
	assert.strictEqual(match('r6xg6', TWO_ROOKS).move.san, 'Rbxg6');
	assert.strictEqual(match('rb6xg6', TWO_ROOKS).move.san, 'Rbxg6');
});

test('an undisambiguated capture still reports the tie', () => {
	const r = match('rxg6', TWO_ROOKS);
	assert.strictEqual(r.state, 'ambiguous');
	assert.deepStrictEqual(r.candidates.map(m => m.san).sort(), ['Rbxg6', 'Rgxg6']);
});

test('origin hints do not leak into pawn moves', () => {
	// "exd5" must not become reachable as "d5", which is a different move.
	const moves = [mv('exd5','e4','d5'), mv('d5','d4','d5')];
	const r = match('d5', moves);
	assert.strictEqual(r.state, 'unique');
	assert.strictEqual(r.move.san, 'd5');
});

test('origin hints survive promotion suffixes', () => {
	const moves = [mv('Nge7','g8','e7'), mv('Nce7','c6','e7')];
	assert.strictEqual(match('n8e7', moves).move.san, 'Nge7');
	assert.strictEqual(match('n6e7', moves).move.san, 'Nce7');
});

// The tail-absorption rule in main.js is built from forms()/canon(), so the
// cases that motivated it are pinned here.
const { forms } = require('../scripts/keyboard-move/matcher.js');
const continues = (move, consumed, key) =>
	forms(move).some(f => f.startsWith(canon(consumed) + canon(key)));

test('leftover keys after an early commit are recognised as continuation', () => {
	// "Nc7" commits at "nc"; the trailing "7" must be absorbed, not treated as new.
	assert.ok(continues(mv('Nc7','e6','c7'), 'nc', '7'));
});

test('a one-keystroke commit absorbs the whole rest of the move', () => {
	// The rated-puzzle case: "r" alone was unique, so "Rxd2" fires on the "r".
	const m = mv('Rxd2','d1','d2');
	assert.ok(continues(m, 'r', 'x'));
	assert.ok(continues(m, 'rx', 'd'));
	assert.ok(continues(m, 'rxd', '2'));
});

test('punctuation typed after a commit is absorbed', () => {
	assert.ok(continues(mv('Rb1+','b4','b1'), 'rb1', '+'));
	assert.ok(continues(mv('e8=Q','e7','e8','q'), 'e8', '='));
	assert.ok(continues(mv('e8=Q','e7','e8','q'), 'e8', 'Q'));
});

test('an unrelated key is not absorbed as continuation', () => {
	assert.ok(!continues(mv('Nc7','e6','c7'), 'nc', 'e'));
	assert.ok(!continues(mv('e4','e2','e4'), 'e4', 'n'));
});

// 4k3/4b3/1p6/2N5/8/8/8/4K3 b - - 0 1 - the Chessable position where the b-pawn
// and the bishop can both take on c5, so SAN's only separator is letter case.
const BOTH_TAKE_C5 = [
	mv('bxc5','b6','c5'), mv('Bxc5','e7','c5'), mv('b5','b6','b5'),
	mv('Bd6','e7','d6'), mv('Bd8','e7','d8'), mv('Bf8','e7','f8'),
	mv('Bf6','e7','f6'), mv('Bg5','e7','g5'), mv('Bh4+','e7','h4'),
	mv('Kf8','e8','f8'), mv('Kf7','e8','f7'), mv('Kd8','e8','d8'),
];

test('lowercase b takes the pawn capture, uppercase B the bishop', () => {
	const pawn = match('bxc5', BOTH_TAKE_C5);
	assert.strictEqual(pawn.state, 'unique');
	assert.strictEqual(pawn.move.san, 'bxc5');

	const bishop = match('Bxc5', BOTH_TAKE_C5);
	assert.strictEqual(bishop.state, 'unique');
	assert.strictEqual(bishop.move.san, 'Bxc5');
});

test('case still separates them with the x left out', () => {
	assert.strictEqual(match('bc5', BOTH_TAKE_C5).move.san, 'bxc5');
	assert.strictEqual(match('Bc5', BOTH_TAKE_C5).move.san, 'Bxc5');
});

test('a lowercase file letter does not hide a bishop move it cannot collide with', () => {
	// No pawn move is spelled "bg5", so lowercase must still reach the bishop.
	assert.strictEqual(match('bg5', BOTH_TAKE_C5).move.san, 'Bg5');
});

test('the b-pawn push is unaffected by the narrowing', () => {
	assert.strictEqual(match('b5', BOTH_TAKE_C5).move.san, 'b5');
});

test('a pawn capture can be spelled from its origin square', () => {
	assert.strictEqual(match('b6xc5', BOTH_TAKE_C5).move.san, 'bxc5');
	assert.strictEqual(match('b6c5', BOTH_TAKE_C5).move.san, 'bxc5');
	assert.strictEqual(match('e7xc5', BOTH_TAKE_C5).move.san, 'Bxc5');
});

test('a pawn capture gains no shorter origin hint than the full square', () => {
	// "exd5" must not become "d5": that is a different, legal push.
	const moves = [mv('exd5','e4','d5'), mv('d5','d4','d5')];
	assert.strictEqual(match('d5', moves).move.san, 'd5');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
