const assert = require('assert');
const { isEditable, shouldRelease, shouldResume, originalTarget, deepActive } = require('../scripts/keyboard-move/blur.js');

let passed = 0, failed = 0;
function test(name, fn) {
	try { fn(); passed++; }
	catch (e) { failed++; console.error('FAIL  ' + name + '\n      ' + e.message); }
}

const el = (tagName, extra) => Object.assign({ tagName, isContentEditable: false }, extra);
const esc = extra => Object.assign({ key: 'Escape' }, extra);

test('text boxes of every shape count as editable', () => {
	assert.ok(isEditable(el('INPUT')));
	assert.ok(isEditable(el('TEXTAREA')));
	assert.ok(isEditable(el('SELECT')));
	// Monaco, which is what onecompiler.com runs, focuses a real textarea.
	assert.ok(isEditable(el('TEXTAREA', { className: 'inputarea' })));
	// claude.ai and chatgpt.com compose into a contenteditable div.
	assert.ok(isEditable(el('DIV', { isContentEditable: true })));
});

test('ordinary elements do not', () => {
	assert.ok(!isEditable(el('DIV')));
	assert.ok(!isEditable(el('BODY')));
	assert.ok(!isEditable(null));
	assert.ok(!isEditable(undefined));
});

test('Escape in a text box releases it', () => {
	assert.ok(shouldRelease(esc(), el('TEXTAREA')));
	assert.ok(shouldRelease(esc(), el('DIV', { isContentEditable: true })));
});

test('Escape outside a text box releases nothing', () => {
	// Nothing to give back, and the page layer already binds Escape itself.
	assert.ok(!shouldRelease(esc(), el('BODY')));
});

test('other keys never release', () => {
	assert.ok(!shouldRelease({ key: 'a' }, el('TEXTAREA')));
	assert.ok(!shouldRelease({ key: 'Enter' }, el('TEXTAREA')));
});

test('a modified Escape is left alone', () => {
	// Shift+Escape and friends belong to the page, or to the browser.
	for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
		assert.ok(!shouldRelease(esc({ [mod]: true }), el('TEXTAREA')), mod);
	}
});

test('a missing event is not a release', () => {
	assert.ok(!shouldRelease(null, el('TEXTAREA')));
});

// ------------------------------------------------------- shadow boundaries

// The bug this came from: a command line inside a shadow root looked like a
// plain <div> to every guard on window, so typing "collapse" into it scrolled
// the page on the "s" instead of typing it.

test('the real target is found through a shadow boundary', () => {
	const input = el('INPUT');
	const shadowHost = el('DIV');
	// composedPath() reports the true target first, the host after it.
	const event = { key: 's', composedPath: () => [input, shadowHost, { tagName: 'BODY' }] };
	assert.strictEqual(originalTarget(event), input);
	assert.ok(isEditable(originalTarget(event)), 'must read as editable');
});

test('a plain event still reports its own target', () => {
	const div = el('DIV');
	assert.strictEqual(originalTarget({ key: 's', target: div }), div);
	// An event already finished dispatching returns an empty path.
	assert.strictEqual(originalTarget({ key: 's', target: div, composedPath: () => [] }), div);
	assert.strictEqual(originalTarget(null), null);
});

test('activeElement is followed into a shadow root', () => {
	const input = el('INPUT');
	const host = el('DIV', { shadowRoot: { activeElement: input } });
	assert.strictEqual(deepActive({ activeElement: host }), input);
});

test('activeElement is followed through nested shadow roots', () => {
	const input = el('TEXTAREA');
	const inner = el('DIV', { shadowRoot: { activeElement: input } });
	const outer = el('DIV', { shadowRoot: { activeElement: inner } });
	assert.strictEqual(deepActive({ activeElement: outer }), input);
});

test('activeElement without a shadow root is returned as is', () => {
	const body = el('BODY');
	assert.strictEqual(deepActive({ activeElement: body }), body);
	assert.strictEqual(deepActive({ activeElement: null }), null);
	assert.strictEqual(deepActive(null), null);
});

test('an empty shadow root does not swallow the host', () => {
	// Focus on the host itself, nothing focused inside it.
	const host = el('DIV', { shadowRoot: { activeElement: null } });
	assert.strictEqual(deepActive({ activeElement: host }), host);
});

test('a shadow-rooted text box releases on Escape', () => {
	const input = el('INPUT');
	const host = el('DIV', { shadowRoot: { activeElement: input } });
	const active = deepActive({ activeElement: host });
	assert.ok(shouldRelease(esc(), active));
	// and the host alone, which is what the old code saw, does not
	assert.ok(!shouldRelease(esc(), host));
});

// --------------------------------------------------------- the way back in

test('"i" outside a text box asks to go back in', () => {
	assert.ok(shouldResume({ key: 'i' }, el('BODY')));
});

test('"i" inside a text box is just a letter', () => {
	// Otherwise the word "into" could never be typed.
	assert.ok(!shouldResume({ key: 'i' }, el('TEXTAREA')));
	assert.ok(!shouldResume({ key: 'i' }, el('DIV', { isContentEditable: true })));
});

test('a modified or capital i is left alone', () => {
	for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
		assert.ok(!shouldResume({ key: 'i', [mod]: true }, el('BODY')), mod);
	}
});

test('other letters do not resume', () => {
	assert.ok(!shouldResume({ key: 'a' }, el('BODY')));
	assert.ok(!shouldResume({ key: 'Escape' }, el('BODY')));
	assert.ok(!shouldResume(null, el('BODY')));
});

test('release and resume are never both true for one key', () => {
	// They are opposite gestures and must not overlap.
	for (const key of ['i', 'Escape', 'a']) {
		for (const active of [el('BODY'), el('TEXTAREA')]) {
			const e = { key };
			assert.ok(!(shouldRelease(e, active) && shouldResume(e, active)),
				key + ' on ' + active.tagName);
		}
	}
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
