const assert = require('assert');
const fs = require('fs');
const { BUILT_IN, hostOf, patternsFor } = require('../scripts/site-patterns.js');

let passed = 0, failed = 0;
function test(name, fn) {
	try { fn(); passed++; }
	catch (e) { failed++; console.error('FAIL  ' + name + '\n      ' + e.message); }
}

// ------------------------------------------------------- a server on this box

test('a local address with a port is accepted', () => {
	// The reported case: "http://localhost:4173" was turned away as not a site.
	assert.deepStrictEqual(patternsFor('http://localhost:4173'), ['http://localhost/*']);
});

test('the port is dropped, because a match pattern has none', () => {
	// One grant therefore covers every port on the host.
	assert.deepStrictEqual(patternsFor('http://localhost:4173'), patternsFor('http://localhost:5173'));
});

test('a local address with no scheme asks for both', () => {
	// A dev server is usually http, and guessing https would hand back a grant
	// that silently matches nothing.
	assert.deepStrictEqual(patternsFor('localhost:4173'),
		['http://localhost/*', 'https://localhost/*']);
	assert.deepStrictEqual(patternsFor('127.0.0.1:8080'),
		['http://127.0.0.1/*', 'https://127.0.0.1/*']);
});

test('a scheme that was typed is kept', () => {
	assert.deepStrictEqual(patternsFor('https://localhost:5173'), ['https://localhost/*']);
});

test('a local name gets no subdomain wildcard', () => {
	// There is no apex and no www to miss here, and a wildcard over localhost
	// would be a wide thing to hold for no gain.
	for (const p of patternsFor('localhost')) assert.ok(!p.includes('*.'), p);
});

test('a named local host works too', () => {
	assert.deepStrictEqual(patternsFor('http://app.localhost:3000'), ['http://app.localhost/*']);
});

// --------------------------------------------------------------- ordinary sites

test('a domain gets both the apex and a subdomain wildcard', () => {
	// Match patterns are host-exact: asking only for what was typed enables the
	// site everywhere except where people actually go.
	assert.deepStrictEqual(patternsFor('youtube.com'),
		['https://youtube.com/*', 'https://*.youtube.com/*']);
});

test('www and a path are ignored', () => {
	assert.deepStrictEqual(patternsFor('www.youtube.com/watch?v=1'), patternsFor('youtube.com'));
});

test('a public site is never asked for over http', () => {
	// The manifest offers http for loopback only; granting it elsewhere is not
	// something a typo should be able to ask for.
	for (const input of ['http://example.com', 'http://192.168.1.5:3000', 'example.com']) {
		for (const p of (patternsFor(input) || [])) {
			assert.ok(p.startsWith('https://'), input + ' -> ' + p);
		}
	}
});

test('nonsense is refused rather than guessed at', () => {
	for (const input of ['', '   ', 'nonsense', 'http://', null, undefined]) {
		assert.strictEqual(patternsFor(input), null, JSON.stringify(input));
	}
});

// ------------------------------------------------------------------- host names

test('a host reads back out of either pattern form', () => {
	assert.strictEqual(hostOf('https://*.youtube.com/*'), 'youtube.com');
	assert.strictEqual(hostOf('https://youtube.com/*'), 'youtube.com');
	assert.strictEqual(hostOf('http://localhost/*'), 'localhost');
});

// ------------------------------------------------------------ one list, not two

test('the built-in list matches the service worker', () => {
	// The options page used to keep its own copy, and it fell behind when the
	// chat hosts moved into the manifest - which would list them as removable
	// extras that cannot actually be removed.
	const worker = fs.readFileSync(require.resolve('../scripts/background.js'), 'utf8');
	const block = /const BUILT_IN = \[([\s\S]*?)\];/.exec(worker);
	assert.ok(block, 'no BUILT_IN found in background.js');
	const theirs = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
	assert.deepStrictEqual([...theirs].sort(), [...BUILT_IN].sort());
});

test('every built-in host is a bare host name', () => {
	for (const host of BUILT_IN) {
		assert.ok(!/[:/*]/.test(host), host + ' should be a host, not a pattern');
	}
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
