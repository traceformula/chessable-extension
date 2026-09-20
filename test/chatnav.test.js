const assert = require('assert');
const { parse, COMMANDS } = require('../scripts/chat-nav/command.js');
const { label } = require('../scripts/chat-nav/outline.js');
const { siteFor } = require('../scripts/chat-nav/sites.js');

let passed = 0, failed = 0;
function test(name, fn) {
	try { fn(); passed++; }
	catch (e) { failed++; console.error('FAIL  ' + name + '\n      ' + e.message); }
}

// ---------------------------------------------------------------- commands

test('a bare number jumps to that turn', () => {
	assert.deepStrictEqual(parse('42'), { kind: 'jump', turn: 42 });
	assert.deepStrictEqual(parse('1'), { kind: 'jump', turn: 1 });
});

test('$ jumps to the last turn', () => {
	assert.deepStrictEqual(parse('$'), { kind: 'jump', turn: 'last' });
});

test('turn zero names nothing', () => {
	// Turns are counted from one, the way vim counts lines.
	assert.strictEqual(parse('0').kind, 'unknown');
});

test('every command resolves on its first letter alone', () => {
	// The whole point of the chosen names: no first letter is shared.
	const initials = COMMANDS.map(c => c.name[0]);
	assert.strictEqual(new Set(initials).size, initials.length,
		'command initials collide: ' + initials.join(','));
	for (const c of COMMANDS) {
		assert.strictEqual(parse(c.name[0]).kind, c.name,
			'"' + c.name[0] + '" should resolve to ' + c.name);
	}
});

test('a full command name works too', () => {
	assert.strictEqual(parse('collapse').kind, 'collapse');
	assert.strictEqual(parse('quit').kind, 'quit');
});

test('case and surrounding space do not matter', () => {
	assert.strictEqual(parse('  LS  ').kind, 'ls');
});

test('an empty command line does nothing', () => {
	assert.strictEqual(parse('').kind, 'none');
	assert.strictEqual(parse('   ').kind, 'none');
});

test('an unknown command is reported, not guessed at', () => {
	assert.strictEqual(parse('frobnicate').kind, 'unknown');
});

// ---------------------------------------------------------------- outline

test('a short prompt is its own label', () => {
	assert.strictEqual(label('what is en passant'), 'what is en passant');
});

test('the first meaningful line wins, not the first characters', () => {
	// A prompt that opens with a question then pastes a wall of code: the
	// question is the part worth putting in the outline.
	const prompt = 'why does this crash?\n\nfunction boom() {\n  return null.x;\n}';
	assert.strictEqual(label(prompt), 'why does this crash?');
});

test('a leading code fence is skipped', () => {
	const prompt = '```js\nconst x = 1;\n```\nexplain this';
	assert.strictEqual(label(prompt), 'explain this');
});

test('a leading quote is skipped', () => {
	assert.strictEqual(label('> pasted thing\nmy actual question'), 'my actual question');
});

test('a long line is truncated with an ellipsis', () => {
	const out = label('x'.repeat(300));
	assert.strictEqual(out.length, 90);
	assert.ok(out.endsWith('…'));
});

test('a markdown heading loses its hashes', () => {
	assert.strictEqual(label('## the plan'), 'the plan');
});

test('an empty prompt says so rather than rendering blank', () => {
	assert.strictEqual(label(''), '(empty)');
	assert.strictEqual(label(null), '(empty)');
});

test('a prompt that is only code still yields something', () => {
	assert.strictEqual(label('```\ncode\n```'), 'code');
});

// ---------------------------------------------------------------- sites

test('the three chat hosts are recognised', () => {
	assert.strictEqual(siteFor('claude.ai').name, 'claude.ai');
	assert.strictEqual(siteFor('chatgpt.com').name, 'chatgpt');
	assert.strictEqual(siteFor('chat.openai.com').name, 'chatgpt (openai)');
});

test('www forms are recognised, lookalikes are not', () => {
	// The apex/www trap that has already cost this project twice.
	assert.ok(siteFor('www.chatgpt.com'));
	assert.strictEqual(siteFor('chatgpt.com.evil.test'), null);
	assert.strictEqual(siteFor('notclaude.ai'), null);
	assert.strictEqual(siteFor('openai.com'), null);
});

test('every site names a user and an assistant selector', () => {
	const { SITES } = require('../scripts/chat-nav/sites.js');
	for (const s of SITES) {
		assert.ok(s.user.length, s.name + ' has no user selector');
		assert.ok(s.assistant.length, s.name + ' has no assistant selector');
	}
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
