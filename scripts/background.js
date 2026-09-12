// Keeps content scripts registered for the sites added at runtime.
//
// The manifest covers the four chess sites. Anything else the user adds is a
// host permission they granted themselves, through Chrome's own dialog, one
// origin at a time - so the extension asks for nothing broad at install and
// each site can be revoked from chrome://extensions without touching the rest.
//
// Only page navigation extends this way. The board adapters are specific to one
// site's internals and have nothing to offer an arbitrary page.
const PAGE_JS = ['scripts/keyboard-move/hints.js', 'scripts/keyboard-move/scroll.js'];
const PROBE_JS = ['scripts/keyboard-move/clickable-probe.js'];

// Already covered by the manifest; registering them again would double up.
const BUILT_IN = [
	'chess.com', 'www.chess.com',
	'chessable.com', 'www.chessable.com',
	'lichess.org', 'www.lichess.org',
	'clubxiangqi.com', 'www.clubxiangqi.com',
];

function hostOf(origin) {
	try { return new URL(origin.replace(/\*$/, '')).hostname; } catch (e) { return null; }
}

function isBuiltIn(origin) {
	const host = hostOf(origin);
	return !!host && BUILT_IN.includes(host);
}

function idFor(origin, kind) {
	return 'kbm-' + kind + '-' + origin.replace(/[^a-z0-9]/gi, '_');
}

async function sync() {
	const granted = await chrome.permissions.getAll();
	const extra = (granted.origins || []).filter(o => !isBuiltIn(o));

	// Rebuild rather than diff: the set is small and a stale registration is
	// harder to reason about than a rebuild.
	const existing = await chrome.scripting.getRegisteredContentScripts();
	const ours = existing.filter(s => s.id.startsWith('kbm-')).map(s => s.id);
	if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });
	if (!extra.length) return;

	await chrome.scripting.registerContentScripts(extra.flatMap(origin => [
		{
			id: idFor(origin, 'page'), matches: [origin], js: PAGE_JS,
			runAt: 'document_start', allFrames: true, world: 'ISOLATED',
			persistAcrossSessions: true,
		},
		{
			// Must be the page's own world: it wraps addEventListener before the
			// site's code runs, to catch handlers that leave no trace in markup.
			id: idFor(origin, 'probe'), matches: [origin], js: PROBE_JS,
			runAt: 'document_start', allFrames: true, world: 'MAIN',
			persistAcrossSessions: true,
		},
	]));
}

function safeSync() {
	sync().catch(e => console.warn('[kbm] could not sync content scripts:', e));
}

chrome.runtime.onInstalled.addListener(safeSync);
chrome.runtime.onStartup.addListener(safeSync);
chrome.permissions.onAdded.addListener(safeSync);
chrome.permissions.onRemoved.addListener(safeSync);
