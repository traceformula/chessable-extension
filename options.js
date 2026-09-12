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
	// "https://*.youtube.com/*" is not a parseable URL, so read the host directly
	// and drop the wildcard: both forms of a site are shown under one name.
	const m = /^https?:\/\/([^/]+)/.exec(String(origin));
	return m ? m[1].replace(/^\*\./, '') : String(origin);
};

// Accepts "example.com", "www.example.com/path", or a full URL, and returns both
// patterns a site needs.
//
// "https://youtube.com/*" does not match www.youtube.com - Chrome match patterns
// are host-exact - so asking for only what was typed enables the site everywhere
// except where people actually go. The apex is requested alongside a subdomain
// wildcard, which is one prompt either way.
function patternsFor(raw) {
	const text = String(raw || '').trim();
	if (!text) return null;
	let host;
	try {
		host = new URL(text.includes('://') ? text : 'https://' + text).hostname;
	} catch (e) {
		return null;
	}
	if (!host || !host.includes('.')) return null;
	const base = host.replace(/^www\./, '');
	return ['https://' + base + '/*', 'https://*.' + base + '/*'];
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

	// Each site is two patterns; show it once.
	const bySite = new Map();
	for (const origin of origins) {
		const site = hostOf(origin);
		if (!bySite.has(site)) bySite.set(site, []);
		bySite.get(site).push(origin);
	}

	for (const [site, patterns] of bySite) {
		const row = document.createElement('li');
		const name = document.createElement('span');
		name.textContent = site;
		const anyRegistered = patterns.some(
			o => registered.has('kbm-page-' + o.replace(/[^a-z0-9]/gi, '_')));
		if (!anyRegistered) {
			const warn = document.createElement('span');
			warn.className = 'warn';
			warn.textContent = ' — granted, but not registered';
			name.appendChild(warn);
		}
		const remove = document.createElement('button');
		remove.textContent = 'Remove';
		remove.addEventListener('click', async () => {
			await chrome.permissions.remove({ origins: patterns });
			say('Removed ' + site + '.');
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
	const patterns = patternsFor(hostInput.value);
	if (!patterns) { say('That does not look like a site address.', true); return; }
	const label = hostOf(patterns[0]);
	if (BUILT_IN.includes(label)) { say(label + ' is already built in.'); return; }

	let granted = false;
	try {
		granted = await chrome.permissions.request({ origins: patterns });
	} catch (e) {
		say('Chrome refused the request: ' + String(e && e.message || e), true);
		return;
	}
	if (!granted) { say('Not granted — Chrome declined or the prompt was dismissed.', true); return; }

	// Register straight away rather than relying on the permissions event.
	try { await chrome.runtime.sendMessage({ type: 'kbm-sync' }); } catch (e) { /* shown below */ }
	hostInput.value = '';
	say('Added ' + label + '. Reload any open tab on that site to start using it.');
	refresh();
});

refresh();
