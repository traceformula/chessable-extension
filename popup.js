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
