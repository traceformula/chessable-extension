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

test('lowercase bc4 is ambiguous between bishop and b-pawn capture', () => {
	const r = match('bc4', BISHOP_VS_BPAWN);
	assert.strictEqual(r.state, 'ambiguous');
	assert.strictEqual(r.candidates.length, 2);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
