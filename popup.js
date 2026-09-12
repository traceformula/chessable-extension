// Settings live in chrome.storage.sync so they follow the Chrome profile to
// other machines. The content script cannot read that directly - it runs in the
// MAIN world - so a bridge forwards them into the page.
const DEFAULTS = { commit: 'auto', hudScale: 1, premove: false };
const fields = ['commit', 'hudScale', 'premove'];

const BUILT_IN = [
	'chess.com', 'www.chess.com',
	'chessable.com', 'www.chessable.com',
	'lichess.org', 'www.lichess.org',
	'clubxiangqi.com', 'www.clubxiangqi.com',
];

function flashSaved() {
	const el = document.getElementById('saved');
	el.classList.add('on');
	setTimeout(() => el.classList.remove('on'), 900);
}

chrome.storage.sync.get(DEFAULTS, current => {
	for (const name of fields) {
		const el = document.getElementById(name);
		// premove is a boolean behind an on/off select; the others map straight
		// through, apart from hudScale which is numeric.
		el.value = name === 'premove' ? (current[name] ? 'on' : 'off') : String(current[name]);
		el.addEventListener('change', () => {
			let value = el.value;
			if (name === 'hudScale') value = Number(value);
			if (name === 'premove') value = value === 'on';
			chrome.storage.sync.set({ [name]: value }, flashSaved);
		});
	}
});

// --- sites ------------------------------------------------------------------
//
// Read-only here. Adding one opens the options page, because Chrome's permission
// prompt can close a popup and cancel the very request it was opened for - which
// is how enabling a site appeared to work while granting nothing at all.
const manageButton = document.getElementById('manageSites');
const siteList = document.getElementById('siteList');
const siteState = document.getElementById('siteState');
const diag = document.getElementById('diag');

const hostOf = origin => {
	// "https://*.youtube.com/*" is not a parseable URL, so read the host directly
	// and drop the wildcard: both forms of a site are shown under one name.
	const m = /^https?:\/\/([^/]+)/.exec(String(origin));
	return m ? m[1].replace(/^\*\./, '') : String(origin);
};

function report(lines, bad) {
	diag.textContent = lines.filter(Boolean).join('\n');
	diag.classList.toggle('bad', !!bad);
}

async function currentTab() {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		return tab || null;
	} catch (e) {
		return null;
	}
}

async function workerStatus() {
	try {
		const reply = await chrome.runtime.sendMessage({ type: 'kbm-status' });
		return reply || { ok: false, error: 'no reply' };
	} catch (e) {
		return { ok: false, error: String(e && e.message || e) };
	}
}

async function render() {
	const status = await workerStatus();
	const granted = (status.origins || []).filter(o => !BUILT_IN.includes(hostOf(o)));
	const registered = new Set(status.registered || []);

	const notes = [];
	let bad = false;
	if (status.ok === false) {
		notes.push('worker: NOT RESPONDING (' + status.error + ')');
		bad = true;
	}

	// Each site is granted as two patterns - the apex and a subdomain wildcard -
	// so list it once.
	const bySite = new Map();
	for (const origin of granted) {
		const site = hostOf(origin);
		if (!bySite.has(site)) bySite.set(site, []);
		bySite.get(site).push(origin);
	}

	siteList.textContent = '';
	for (const [site, patterns] of [...bySite].sort()) {
		const row = document.createElement('li');
		const name = document.createElement('span');
		name.textContent = site;
		if (!patterns.some(o => registered.has('kbm-page-' + o.replace(/[^a-z0-9]/gi, '_')))) {
			const warn = document.createElement('small');
			warn.textContent = ' — not registered';
			warn.style.color = '#c0504a';
			name.appendChild(warn);
			notes.push(site + ': granted but not registered');
			bad = true;
		}
		const remove = document.createElement('button');
		remove.textContent = 'remove';
		remove.addEventListener('click', async () => {
			await chrome.permissions.remove({ origins: patterns });
			render();
		});
		row.append(name, remove);
		siteList.appendChild(row);
	}
	if (!bySite.size) notes.push('no extra sites added yet');
	report(notes, bad);

	const tab = await currentTab();
	let url = null;
	try { url = tab && tab.url ? new URL(tab.url) : null; } catch (e) { url = null; }

	if (!url) {
		siteState.textContent = 'Runs on the chess sites. Add others below.';
	} else if (BUILT_IN.includes(url.hostname)) {
		siteState.textContent = url.hostname + ' is built in.';
	} else if (granted.some(o => hostOf(o) === url.hostname.replace(/^www\./, ''))) {
		siteState.textContent = url.hostname + ' is enabled.';
	} else {
		siteState.textContent = url.hostname + ' is not enabled yet.';
	}
}

manageButton.addEventListener('click', () => {
	chrome.runtime.openOptionsPage();
	window.close();
});

render().catch(e => {
	// A throw here used to leave the section blank, which reads as "nothing to
	// report" rather than "this broke".
	diag.textContent = 'popup error: ' + String(e && e.message || e);
	diag.classList.add('bad');
});
