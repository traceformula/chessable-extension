// Adding sites lives here rather than in the popup.
//
// chrome.permissions.request() has to be called from a user gesture, and a popup
// is a poor place to do it: showing Chrome's dialog can close the popup, which
// takes the pending request down with it. The request then neither succeeds nor
// reports an error - which is exactly how enabling a site appeared to work while
// granting nothing. A full page stays open while the dialog is up.
const BUILT_IN = [
	'chess.com', 'www.chess.com',
	'chessable.com', 'www.chessable.com',
	'lichess.org', 'www.lichess.org',
	'clubxiangqi.com', 'www.clubxiangqi.com',
];

const form = document.getElementById('addForm');
const hostInput = document.getElementById('host');
const list = document.getElementById('list');
const empty = document.getElementById('empty');
const msg = document.getElementById('msg');
const diag = document.getElementById('diag');

const hostOf = origin => {
	try { return new URL(origin.replace(/\*$/, '')).hostname; } catch (e) { return origin; }
};

// Accepts "example.com", "www.example.com/path", or a full URL.
function patternFor(raw) {
	const text = String(raw || '').trim();
	if (!text) return null;
	let host;
	try {
		host = new URL(text.includes('://') ? text : 'https://' + text).hostname;
	} catch (e) {
		return null;
	}
	if (!host || !host.includes('.')) return null;
	return 'https://' + host + '/*';
}

function say(text, bad) {
	msg.textContent = text || '';
	msg.className = bad ? 'warn' : 'muted';
}

async function extraOrigins() {
	const { origins } = await chrome.permissions.getAll();
	return (origins || []).filter(o => !BUILT_IN.includes(hostOf(o)));
}

async function refresh() {
	const origins = (await extraOrigins()).sort();
	list.textContent = '';
	empty.hidden = origins.length > 0;

	let status = {};
	try {
		const reply = await chrome.runtime.sendMessage({ type: 'kbm-status' });
		status = reply || {};
	} catch (e) {
		status = { ok: false, error: String(e && e.message || e) };
	}
	const registered = new Set(status.registered || []);

	for (const origin of origins) {
		const row = document.createElement('li');
		const name = document.createElement('span');
		name.textContent = hostOf(origin);
		const id = 'kbm-page-' + origin.replace(/[^a-z0-9]/gi, '_');
		if (!registered.has(id)) {
			const warn = document.createElement('span');
			warn.className = 'warn';
			warn.textContent = ' — granted, but not registered';
			name.appendChild(warn);
		}
		const remove = document.createElement('button');
		remove.textContent = 'Remove';
		remove.addEventListener('click', async () => {
			await chrome.permissions.remove({ origins: [origin] });
			say('Removed ' + hostOf(origin) + '.');
			refresh();
		});
		row.append(name, remove);
		list.appendChild(row);
	}

	diag.textContent = JSON.stringify({
		granted: status.origins || [],
		registered: status.registered || [],
		lastRegistration: status.lastRegistration || null,
		workerError: status.ok === false ? status.error : undefined,
	}, null, 2);
}

form.addEventListener('submit', async event => {
	event.preventDefault();
	const pattern = patternFor(hostInput.value);
	if (!pattern) { say('That does not look like a site address.', true); return; }
	if (BUILT_IN.includes(hostOf(pattern))) { say(hostOf(pattern) + ' is already built in.'); return; }

	let granted = false;
	try {
		granted = await chrome.permissions.request({ origins: [pattern] });
	} catch (e) {
		say('Chrome refused the request: ' + String(e && e.message || e), true);
		return;
	}
	if (!granted) { say('Not granted — Chrome declined or the prompt was dismissed.', true); return; }

	// Register straight away rather than relying on the permissions event.
	try { await chrome.runtime.sendMessage({ type: 'kbm-sync' }); } catch (e) { /* shown below */ }
	hostInput.value = '';
	say('Added ' + hostOf(pattern) + '. Reload any open tab on that site to start using it.');
	refresh();
});

refresh();
