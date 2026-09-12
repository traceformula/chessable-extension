// Label generation is the one part of the hint engine that is pure logic, and
// the part where a mistake is silent: a label that prefixes another can never be
// typed, because the shorter one fires first.
const assert = require('assert');
// hints.js registers its key listeners as soon as it loads, so the stubs have to
// be real EventTargets - node's addEventListener refuses a plain object.
globalThis.__KBM = {};
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), {
	getElementById: () => null,
	querySelectorAll: () => [],
	documentElement: null,
});
require('../scripts/keyboard-move/hints.js');
const labelsFor = globalThis.__KBM.hintLabels;

let passed = 0, failed = 0;
function test(name, fn) {
	try { fn(); passed++; }
	catch (e) { failed++; console.error('FAIL  ' + name + '\n      ' + e.message); }
}

const noPrefixCollision = labels => labels.every(
	a => labels.every(b => a === b || !b.startsWith(a)));

test('a handful of links all get one character', () => {
	const labels = labelsFor(8);
	assert.strictEqual(labels.length, 8);
	assert.ok(labels.every(l => l.length === 1), labels.join(' '));
});

test('just over the alphabet still keeps most labels at one character', () => {
	// The bug this replaced: 26 links meant 26 two-character labels.
	const labels = labelsFor(26);
	assert.strictEqual(labels.length, 26);
	const singles = labels.filter(l => l.length === 1).length;
	assert.ok(singles >= 12, 'only ' + singles + ' single-character labels');
});

test('no label is a prefix of another', () => {
	for (const n of [1, 13, 14, 15, 26, 40, 100, 197, 250]) {
		assert.ok(noPrefixCollision(labelsFor(n)), 'collision at n=' + n);
	}
});

test('labels are unique and sufficient at every size', () => {
	for (const n of [1, 14, 15, 99, 250]) {
		const labels = labelsFor(n);
		assert.strictEqual(labels.length, n, 'wrong count at n=' + n);
		assert.strictEqual(new Set(labels).size, n, 'duplicates at n=' + n);
	}
});

test('single-character labels come first, where the page is most prominent', () => {
	const labels = labelsFor(26);
	assert.strictEqual(labels[0].length, 1);
	assert.strictEqual(labels[labels.length - 1].length, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
