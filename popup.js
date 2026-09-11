// Settings live in chrome.storage.sync so they follow the Chrome profile to
// other machines. The content script cannot read that directly - it runs in the
// MAIN world - so a bridge forwards them into the page.
const DEFAULTS = { commit: 'auto', hudScale: 1 };
const fields = ['commit', 'hudScale'];

function flashSaved() {
	const el = document.getElementById('saved');
	el.classList.add('on');
	setTimeout(() => el.classList.remove('on'), 900);
}

chrome.storage.sync.get(DEFAULTS, current => {
	for (const name of fields) {
		const el = document.getElementById(name);
		el.value = String(current[name]);
		el.addEventListener('change', () => {
			const value = name === 'hudScale' ? Number(el.value) : el.value;
			chrome.storage.sync.set({ [name]: value }, flashSaved);
		});
	}
});
