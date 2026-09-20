// Loads chat-nav's key handler under a stub DOM and calls it directly.
//
// This exists because of a real bug: a scripted edit dropped the line
// declaring the interface variables, so the very first key threw
// ReferenceError inside the handler and the whole subsystem was dead - no
// command line, no ":ls", nothing - while every other test still passed.
// Neither `node --check` nor the pure-logic tests can see that: the file parses
// fine and the fault is in a function none of them call.
//
// The handler is called directly rather than dispatched, for the same reason
// hints.test.js does: a listener that throws during dispatchEvent reports the
// error asynchronously, and the test would sail past a completely broken one.
const assert = require('assert');

let passed = 0, failed = 0;
function test(name, fn) {
	try { fn(); passed++; }
	catch (e) { failed++; console.error('FAIL  ' + name + '\n      ' + e.message); }
}

function element(tag) {
	const el = {
		tagName: String(tag || 'div').toUpperCase(),
		className: '', id: '', textContent: '', value: '', hidden: false,
		dataset: {}, children: [], shadowRoot: null,
		style: { setProperty() {}, removeProperty() {} },
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		append(...kids) { this.children.push(...kids); },
		appendChild(kid) { this.children.push(kid); return kid; },
		addEventListener() {}, removeEventListener() {},
		focus() {}, blur() {}, remove() {}, closest() { return null; },
		querySelector() { return null; }, querySelectorAll() { return []; },
		getAttribute() { return null; }, setAttribute() {},
		getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
		attachShadow() {
			this.shadowRoot = {
				append() {}, querySelector() { return element('div'); },
			};
			return this.shadowRoot;
		},
	};
	return el;
}

function loadChatNav() {
	for (const id of Object.keys(require.cache)) delete require.cache[id];
	delete globalThis.__CHATNAV;

	const keydown = [];
	const documentElement = element('html');

	globalThis.location = { hostname: 'claude.ai', pathname: '/chat/0e2dcc71-c531-4bc6-b114-d2952c24252f' };
	globalThis.document = {
		documentElement,
		head: element('head'),
		readyState: 'complete',
		activeElement: null,
		createElement: element,
		querySelector() { return null; },
		querySelectorAll() { return []; },
		addEventListener(type, fn) { if (type === 'keydown') keydown.push(fn); },
	};
	globalThis.window = {
		addEventListener(type, fn) { if (type === 'keydown') keydown.push(fn); },
	};
	globalThis.getComputedStyle = () => ({ overflowY: 'visible' });
	globalThis.chrome = { storage: { local: { get(_d, cb) { cb({ chatNavMuted: false }); }, set() {} } } };

	require('../scripts/chat-nav/sites.js');
	require('../scripts/chat-nav/outline.js');
	require('../scripts/chat-nav/command.js');
	require('../scripts/chat-nav/claude-api.js');
	require('../scripts/chat-nav/chatgpt-api.js');
	require('../scripts/chat-nav/main.js');

	return { keydown, documentElement };
}

const key = (k, extra) => Object.assign({
	key: k, target: null, defaultPrevented: false,
	metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
	preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
	composedPath() { return []; },
}, extra);

test('the subsystem starts up and registers a key handler', () => {
	const { keydown, documentElement } = loadChatNav();
	assert.ok(keydown.length >= 1, 'no keydown handler was registered');
	assert.ok(documentElement.dataset.chatNav, 'never finished starting up');
});

test('a colon reaches the handler without throwing', () => {
	// The exact failure: ReferenceError on the first key, from a variable whose
	// declaration an edit had removed.
	const { keydown, documentElement } = loadChatNav();
	keydown[0](key(':'));
	assert.ok(documentElement.dataset.chatNavLast,
		'the handler ran but recorded nothing');
	// The first stamp says the key arrived; the outcome overwrites it. With
	// nothing focused there is no reason to decline.
	assert.strictEqual(documentElement.dataset.chatNavLast, 'colon opened the command line');
});

test('Escape reaches the handler without throwing', () => {
	const { keydown, documentElement } = loadChatNav();
	keydown[0](key('Escape'));
	assert.strictEqual(documentElement.dataset.chatNavLast, 'esc, nothing focused');
});

test('an ordinary letter is seen and left alone', () => {
	const { keydown, documentElement } = loadChatNav();
	keydown[0](key('a'));
	assert.ok(/saw a/.test(documentElement.dataset.chatNavLast || ''));
});

test('every handler registered survives the same key', () => {
	// Both window and document carry one; a flag keeps the body to one run, but
	// neither may throw.
	const { keydown } = loadChatNav();
	const event = key(':');
	for (const handler of keydown) handler(event);
	assert.ok(true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
