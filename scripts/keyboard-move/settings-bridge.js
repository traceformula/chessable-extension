// Carries settings from chrome.storage into the page.
//
// Everything else in this feature runs in the MAIN world, because reaching the
// game object on <wc-chess-board> requires it - and the MAIN world has no access
// to chrome.storage. This script runs in the isolated world, where the reverse is
// true, and hands settings across by postMessage.
(function () {
	const DEFAULTS = { commit: 'auto', hudScale: 1 };
	const CHANNEL = 'kbm-settings';

	function push() {
		chrome.storage.sync.get(DEFAULTS, settings => {
			if (chrome.runtime.lastError) return;
			window.postMessage({ channel: CHANNEL, settings }, window.location.origin);
		});
	}

	// Injection order across worlds is not guaranteed, so a push on load can
	// arrive before the page side is listening. The page also asks on startup,
	// which closes that race from the other end.
	window.addEventListener('message', e => {
		if (e.source !== window) return;
		if (e.data && e.data.channel === CHANNEL + '-request') push();
	});

	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync') push();
	});

	push();
})();
