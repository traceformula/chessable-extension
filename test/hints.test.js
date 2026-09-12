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
	documentElement: { dataset: {} },
});

// Capture the key handler as it registers, so the tests can call it directly.
// Dispatching through EventTarget will not do: node reports a listener's
// exception asynchronously, so a synchronous assertion sees nothing thrown and
// the test passes over a handler that is completely broken.
const handlers = [];
const nativeAdd = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function (type, listener, options) {
	if (type === 'keydown') handlers.push(listener);
	return nativeAdd.call(this, type, listener, options);
};
require('../scripts/keyboard-move/hints.js');
// scroll.js has the same shape - one handler, every shortcut behind it - so it
// is captured and exercised here too.
globalThis.getComputedStyle = () => ({ overflowY: 'visible' });
globalThis.innerHeight = 800;
globalThis.document.scrollingElement = { scrollHeight: 100, clientHeight: 100 };
require('../scripts/keyboard-move/scroll.js');
EventTarget.prototype.addEventListener = nativeAdd;
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

// The key handler is one function, so anything throwing in its opening lines
// takes every shortcut down with it - hints, escape, find, the lot. A missing
// declaration did exactly that and shipped: --check does not resolve
// identifiers, and nothing here had ever invoked the handler.
function press(key, extra) {
	const event = Object.assign({
		key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
		target: globalThis.document, defaultPrevented: false,
		preventDefault() { this.defaultPrevented = true; },
		stopImmediatePropagation() { this.stopped = true; },
	}, extra || {});
	for (const handler of handlers) handler(event);
	return event;
}

test('both page-layer key handlers registered themselves', () => {
	// hints.js and scroll.js each bind window and document.
	assert.ok(handlers.length >= 4, 'registered ' + handlers.length + ' handlers');
});

test('the key handler runs without throwing', () => {
	// "z" is bound to nothing, so this exercises the whole preamble - the part
	// every other key also has to survive - and stops before anything that needs
	// a real document.
	assert.doesNotThrow(() => press('z'));
});

test('an unhandled key is left alone', () => {
	assert.strictEqual(press('z').defaultPrevented, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
