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

async function render() {
	const granted = await grantedOrigins();
	siteList.textContent = '';
	for (const origin of granted.sort()) {
		const row = document.createElement('li');
		const name = document.createElement('span');
		name.textContent = hostOf(origin);
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
		try { await chrome.permissions.request({ origins: [pattern] }); }
		catch (e) { /* declined, or not a gesture */ }
		render();
	};
}

render();
