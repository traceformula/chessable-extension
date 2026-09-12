// Settings live in chrome.storage.sync so they follow the Chrome profile to
// other machines. The content script cannot read that directly - it runs in the
// MAIN world - so a bridge forwards them into the page.
const DEFAULTS = { commit: 'auto', hudScale: 1, premove: false };
const fields = ['commit', 'hudScale', 'premove'];

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

// --- sites added at runtime -------------------------------------------------
//
// Each one is a host permission the user grants through Chrome's own dialog, so
// the extension asks for nothing broad at install. The request has to come from
// a click: Chrome requires a user gesture, which is the right constraint.
const BUILT_IN = [
	'chess.com', 'www.chess.com',
	'chessable.com', 'www.chessable.com',
	'lichess.org', 'www.lichess.org',
	'clubxiangqi.com', 'www.clubxiangqi.com',
];

const addButton = document.getElementById('addSite');
const siteList = document.getElementById('siteList');
const siteState = document.getElementById('siteState');

const hostOf = origin => {
	try { return new URL(origin.replace(/\*$/, '')).hostname; } catch (e) { return origin; }
};

async function currentTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab || null;
}

async function grantedOrigins() {
	const { origins } = await chrome.permissions.getAll();
	return (origins || []).filter(o => !BUILT_IN.includes(hostOf(o)));
}

// Ask the worker to (re)register and hand back what happened, so a site that was
// granted but whose scripts failed to register is visibly different from one
// that is working.
async function syncNow() {
	try { return await chrome.runtime.sendMessage({ type: 'kbm-sync' }); }
	catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

function problemWith(entry) {
	if (!entry) return 'not registered';
	const bad = ['page', 'probe'].filter(k => entry[k] !== 'ok');
	if (!bad.length) return null;
	return bad.map(k => entry[k] || 'not registered').join('; ');
}

async function render() {
	const granted = await grantedOrigins();
	const result = await syncNow();
	const status = (result && result.status) || {};

	siteList.textContent = '';
	for (const origin of granted.sort()) {
		const row = document.createElement('li');
		const name = document.createElement('span');
		const problem = problemWith(status[origin]);
		name.textContent = hostOf(origin);
		if (problem) {
			name.title = problem;
			const warn = document.createElement('small');
			warn.textContent = ' — not working';
			warn.style.color = '#c0504a';
			name.appendChild(warn);
		}
		const remove = document.createElement('button');
		remove.textContent = 'remove';
		remove.addEventListener('click', async () => {
			await chrome.permissions.remove({ origins: [origin] });
			render();
		});
		row.append(name, remove);
		siteList.appendChild(row);
	}

	const tab = await currentTab();
	let url = null;
	try { url = tab && tab.url ? new URL(tab.url) : null; } catch (e) { url = null; }

	if (!url || url.protocol !== 'https:') {
		addButton.hidden = true;
		siteState.textContent = granted.length
			? 'Open a site to add it here.'
			: 'Runs on the chess sites automatically. Open another site to add it.';
		return;
	}
	const pattern = 'https://' + url.hostname + '/*';
	if (BUILT_IN.includes(url.hostname)) {
		addButton.hidden = true;
		siteState.textContent = url.hostname + ' is built in.';
		return;
	}
	if (granted.includes(pattern)) {
		addButton.hidden = true;
		siteState.textContent = url.hostname + ' is enabled.';
		return;
	}
	addButton.hidden = false;
	addButton.textContent = 'Enable on ' + url.hostname;
	siteState.textContent = 'Adds link hints and scrolling. Chrome will ask you to confirm.';
	addButton.onclick = async () => {
		let ok = false;
		try { ok = await chrome.permissions.request({ origins: [pattern] }); }
		catch (e) { ok = false; }
		// Registration follows the grant, and the page needs reloading before
		// scripts injected at document_start can run on it.
		if (ok) {
			await syncNow();
			siteState.textContent = 'Enabled. Reload the page to start using it.';
		}
		render();
	};
}

render();
