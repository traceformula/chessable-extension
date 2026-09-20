const assert = require('assert');
const { parse, COMMANDS } = require('../scripts/chat-nav/command.js');
const { label } = require('../scripts/chat-nav/outline.js');
const { siteFor } = require('../scripts/chat-nav/sites.js');
const { turnsFromConversation, textOf } = require('../scripts/chat-nav/claude-api.js');

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

// ------------------------------------------------- the complete transcript

// claude.ai renders only the rows near the viewport, so counting what is in
// the page reported "2 turns" for a conversation with 38. These cover reading
// the whole thing from the payload the page itself loads.

const msg = (sender, index, text, extra) => Object.assign({
	sender, index,
	text: '',                       // empty on current conversations
	content: [{ type: 'text', text }],
}, extra);

test('every human turn is found, with the row index that locates it', () => {
	const payload = { chat_messages: [
		msg('human', 0, 'first question'),
		msg('assistant', 1, 'an answer'),
		msg('human', 2, 'second question'),
		msg('assistant', 3, 'another answer'),
	] };
	const out = turnsFromConversation(payload);
	assert.strictEqual(out.total, 4);
	assert.deepStrictEqual(out.turns.map(t => t.row), [0, 2]);
	assert.deepStrictEqual(out.turns.map(t => t.text), ['first question', 'second question']);
});

test('a 38-turn conversation reports 38, not what is on screen', () => {
	// The reported case: 76 messages, 38 of them human.
	const messages = [];
	for (let i = 0; i < 76; i++) {
		messages.push(msg(i % 2 === 0 ? 'human' : 'assistant', i, 'turn ' + i));
	}
	const out = turnsFromConversation({ chat_messages: messages });
	assert.strictEqual(out.total, 76);
	assert.strictEqual(out.turns.length, 38);
	assert.strictEqual(out.turns[37].row, 74);
});

test('thinking blocks are not mistaken for what was typed', () => {
	const m = { sender: 'human', index: 0, content: [
		{ type: 'thinking', thinking: 'pondering' },
		{ type: 'text', text: 'the actual prompt' },
	] };
	assert.strictEqual(textOf(m), 'the actual prompt');
});

test('several text blocks are joined', () => {
	const m = { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] };
	assert.strictEqual(textOf(m), 'one\ntwo');
});

test('the plain text field is used when there are no blocks', () => {
	assert.strictEqual(textOf({ text: 'older shape' }), 'older shape');
	assert.strictEqual(textOf({ content: [], text: 'older shape' }), 'older shape');
	assert.strictEqual(textOf(null), '');
});

test('array position stands in for a missing index', () => {
	const out = turnsFromConversation({ chat_messages: [
		{ sender: 'assistant', content: [{ type: 'text', text: 'a' }] },
		{ sender: 'human', content: [{ type: 'text', text: 'q' }] },
	] });
	assert.strictEqual(out.turns[0].row, 1);
});

test('an unusable payload yields nothing rather than an empty outline', () => {
	// Falling back to the DOM is right here; pretending to zero turns is not.
	assert.strictEqual(turnsFromConversation(null), null);
	assert.strictEqual(turnsFromConversation({}), null);
	assert.strictEqual(turnsFromConversation({ chat_messages: [] }), null);
	assert.strictEqual(turnsFromConversation({ chat_messages: [msg('assistant', 0, 'only replies')] }), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
