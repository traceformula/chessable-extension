const assert = require('assert');
const { isEditable, shouldRelease } = require('../scripts/keyboard-move/blur.js');

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
