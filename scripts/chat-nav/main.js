// Vim-style ":" command line for long AI chat transcripts.
//
// Entirely separate from the chess side: its own namespace, its own directory,
// its own manifest entry, its own tests, and not one line of shared code. A
// chat selector going stale cannot touch a board.
//
// The interface lives in a shadow root so the host page's CSS - both of these
// sites ship very assertive global styles - cannot reach it and ours cannot
// leak out. The only thing written into the page itself is one stylesheet for
// the fold, which has to apply to the site's own elements.
//
// Nothing is summarised by a model. The outline is your own prompts, which is
// both the better index and the reason no conversation text has to leave the
// page to build it.
(function () {
	const ns = (globalThis.__CHATNAV = globalThis.__CHATNAV || {});
	if (ns.ready) return;
	const site = ns.sites && ns.sites.siteFor(location.hostname);
	if (!site) return;

	ns.ready = true;
	ns.version = '1.28.0';
	ns.site = site.name;

	const parse = ns.command.parse;
	const COMMANDS = ns.command.COMMANDS;
	const label = ns.outline.label;

	// ------------------------------------------------------------- the fold

	const PAGE_CSS = `
.chatnav-fold {
	max-height: 4.5em !important;
	overflow: hidden !important;
	opacity: .65 !important;
	border-bottom: 1px dashed currentColor !important;
	cursor: zoom-in !important;
}
.chatnav-flash {
	animation: chatnav-flash 1.2s ease-out;
}
@keyframes chatnav-flash {
	from { background-color: rgba(255, 213, 79, .55); }
	to   { background-color: transparent; }
}`;

	function installPageCss() {
		const style = document.createElement('style');
		style.id = 'chatnav-page-css';
		style.textContent = PAGE_CSS;
		(document.head || document.documentElement).appendChild(style);
	}

	// ----------------------------------------------------------- the turns

	// Each chain is tried in order and the first that finds anything wins. When
	// none of them do, that is reported out loud - a site reshuffling its markup
	// is the expected way this breaks, and showing an empty panel would look
	// like an empty conversation.
	function firstMatch(chain) {
		for (const selector of chain) {
			let found = [];
			try { found = Array.from(document.querySelectorAll(selector)); }
			catch (e) { continue; }
			if (found.length) return { selector, elements: found };
		}
		return null;
	}

	function turns() {
		const found = firstMatch(site.user);
		if (!found) return [];
		return found.elements.map((el, i) => ({
			n: i + 1, el, text: label(el.textContent),
		}));
	}

	// -------------------------------------------------------------- the UI

	let host = null, shadow = null, bar = null, input = null, status = null, panel = null;

	const UI_CSS = `
:host { all: initial; }
.wrap {
	position: fixed; left: 0; right: 0; bottom: 0;
	z-index: 2147483647;
	font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	pointer-events: none;
}
.panel, .bar { pointer-events: auto; }
.bar {
	display: flex; align-items: baseline; gap: .4em;
	padding: .35em .6em;
	background: #1c1c1e; color: #f2f2f7;
	border-top: 1px solid #3a3a3c;
}
.bar[hidden], .panel[hidden] { display: none; }
.colon { opacity: .6; }
input {
	flex: 1; min-width: 0;
	background: transparent; border: 0; outline: 0;
	color: inherit; font: inherit;
}
.status { opacity: .65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 55%; }
.panel {
	max-height: 45vh; overflow-y: auto;
	background: #1c1c1e; color: #f2f2f7;
	border-top: 1px solid #3a3a3c;
}
.row {
	display: flex; gap: .7em; padding: .3em .8em;
	cursor: pointer; align-items: baseline;
}
.row:hover { background: #2c2c2e; }
.num { opacity: .5; min-width: 2.2em; text-align: right; flex: none; }
.txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head {
	padding: .35em .8em; opacity: .55;
	border-bottom: 1px solid #3a3a3c; position: sticky; top: 0;
	background: #1c1c1e;
}
.key { display: inline-block; min-width: 5.5em; opacity: .9; }`;

	function build() {
		if (host) return;
		host = document.createElement('div');
		host.id = 'chatnav-root';
		shadow = host.attachShadow({ mode: 'open' });

		const style = document.createElement('style');
		style.textContent = UI_CSS;

		const wrap = document.createElement('div');
		wrap.className = 'wrap';

		panel = document.createElement('div');
		panel.className = 'panel';
		panel.hidden = true;

		bar = document.createElement('div');
		bar.className = 'bar';
		bar.hidden = true;

		const colon = document.createElement('span');
		colon.className = 'colon';
		colon.textContent = ':';

		input = document.createElement('input');
		input.spellcheck = false;
		input.autocomplete = 'off';

		status = document.createElement('span');
		status.className = 'status';

		bar.append(colon, input, status);
		wrap.append(panel, bar);
		shadow.append(style, wrap);
		document.documentElement.appendChild(host);

		// Keep every keystroke in the bar to ourselves. Both sites bind bare
		// letters to their own shortcuts, and one of them would otherwise steal
		// focus back into the composer mid-command.
		input.addEventListener('keydown', onBarKey);
		input.addEventListener('keyup', e => e.stopPropagation());
		input.addEventListener('keypress', e => e.stopPropagation());
	}

	function say(message) {
		build();
		status.textContent = message || '';
	}

	function openBar() {
		build();
		bar.hidden = false;
		input.value = '';
		status.textContent = '';
		input.focus();
	}

	function closeBar() {
		if (!bar) return;
		bar.hidden = true;
		input.value = '';
		input.blur();
	}

	function closePanel() {
		if (panel) { panel.hidden = true; panel.textContent = ''; }
	}

	function renderPanel(heading, rows) {
		build();
		panel.textContent = '';
		const head = document.createElement('div');
		head.className = 'head';
		head.textContent = heading;
		panel.appendChild(head);
		for (const row of rows) panel.appendChild(row);
		panel.hidden = false;
	}

	// ---------------------------------------------------------- the actions

	function flash(el) {
		el.classList.add('chatnav-flash');
		setTimeout(() => el.classList.remove('chatnav-flash'), 1300);
	}

	function jump(which) {
		const list = turns();
		if (!list.length) {
			say('no turns found - selectors may have moved (:h)');
			return;
		}
		const turn = which === 'last' ? list[list.length - 1] : list[which - 1];
		if (!turn) {
			say('only ' + list.length + ' turn' + (list.length === 1 ? '' : 's'));
			return;
		}
		turn.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
		flash(turn.el);
		say(turn.n + '/' + list.length + '  ' + turn.text);
	}

	function list() {
		const all = turns();
		if (!all.length) {
			say('no turns found - selectors may have moved (:h)');
			return;
		}
		const rows = all.map(turn => {
			const row = document.createElement('div');
			row.className = 'row';
			const num = document.createElement('span');
			num.className = 'num';
			num.textContent = turn.n;
			const txt = document.createElement('span');
			txt.className = 'txt';
			txt.textContent = turn.text;          // textContent: never innerHTML
			row.append(num, txt);
			row.addEventListener('click', () => {
				turn.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
				flash(turn.el);
				closePanel();
			});
			return row;
		});
		renderPanel(all.length + ' turns  ·  :N to jump, :q to close', rows);
		say('');
	}

	function fold(on) {
		const found = firstMatch(site.assistant);
		if (!found) {
			say('no replies found - selectors may have moved (:h)');
			return;
		}
		for (const el of found.elements) el.classList.toggle('chatnav-fold', on);
		say((on ? 'folded ' : 'unfolded ') + found.elements.length + ' repl' +
			(found.elements.length === 1 ? 'y' : 'ies') +
			(on ? '  ·  click one to open it' : ''));
	}

	let muted = false;

	function mute(on) {
		if (on) {
			let hidden = 0;
			for (const selector of site.noise) {
				let found = [];
				try { found = Array.from(document.querySelectorAll(selector)); }
				catch (e) { continue; }
				for (const el of found) {
					if (el.dataset.chatnavHid) continue;
					el.dataset.chatnavHid = '1';
					el.style.setProperty('display', 'none', 'important');
					hidden++;
				}
			}
			muted = true;
			say(hidden
				? 'hid ' + hidden + ' element' + (hidden === 1 ? '' : 's')
				: 'nothing matched the noise list for ' + site.name);
		} else {
			const previously = document.querySelectorAll('[data-chatnav-hid]');
			for (const el of previously) {
				el.style.removeProperty('display');
				delete el.dataset.chatnavHid;
			}
			muted = false;
			say('restored ' + previously.length);
		}
		try { chrome.storage.local.set({ chatNavMuted: muted }); } catch (e) { /* fine */ }
	}

	function help() {
		const rows = COMMANDS.map(command => {
			const row = document.createElement('div');
			row.className = 'row';
			const key = document.createElement('span');
			key.className = 'key';
			key.textContent = ':' + command.name;
			const txt = document.createElement('span');
			txt.className = 'txt';
			txt.textContent = command.help;
			row.append(key, txt);
			return row;
		});

		const jumpRow = document.createElement('div');
		jumpRow.className = 'row';
		const jumpKey = document.createElement('span');
		jumpKey.className = 'key';
		jumpKey.textContent = ':N  :$';
		const jumpTxt = document.createElement('span');
		jumpTxt.className = 'txt';
		jumpTxt.textContent = 'jump to turn N, or the last one';
		jumpRow.append(jumpKey, jumpTxt);

		const found = firstMatch(site.user);
		renderPanel(
			site.name + '  ·  v' + ns.version + '  ·  ' +
			(found ? found.elements.length + ' turns via ' + found.selector
			       : 'NO TURNS MATCHED - selectors need updating'),
			[jumpRow].concat(rows));
		say('');
	}

	function run(text) {
		const result = parse(text);
		switch (result.kind) {
			case 'none': break;
			case 'jump': jump(result.turn); break;
			case 'ls': list(); break;
			case 'collapse': fold(true); break;
			case 'expand': fold(false); break;
			case 'mute': mute(!muted); break;
			case 'help': help(); break;
			case 'quit': closePanel(); say(''); break;
			case 'ambiguous':
				say('"' + result.text + '" could be ' + result.matches.join(' or '));
				break;
			default:
				say('not a command: ' + result.text + '   (:h for the list)');
		}
	}

	// ------------------------------------------------------------- the keys

	function onBarKey(e) {
		e.stopPropagation();
		if (e.key === 'Escape') {
			e.preventDefault();
			if (panel && !panel.hidden) closePanel();
			closeBar();
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			const text = input.value;
			input.value = '';
			run(text);
			// The bar stays up: ":ls" then ":7" is the whole point, and vim
			// leaves you on the command line between counted jumps too.
			return;
		}
		if (e.key === 'Backspace' && !input.value) {
			e.preventDefault();
			closeBar();
		}
	}

	function editable(el) {
		if (!el) return false;
		if (el.isContentEditable) return true;
		const tag = el.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
	}

	function onKey(e) {
		if (e.key !== ':' || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.defaultPrevented) return;
		// Never while they are writing a prompt - a colon belongs in the text.
		if (editable(e.target) || editable(document.activeElement)) return;
		e.preventDefault();
		e.stopPropagation();
		openBar();
	}

	// -------------------------------------------------------------- startup

	installPageCss();
	window.addEventListener('keydown', onKey, true);

	// A folded reply opens where you click it, so the fold never hides
	// something you cannot get back.
	document.addEventListener('click', e => {
		const el = e.target && e.target.closest ? e.target.closest('.chatnav-fold') : null;
		if (el) el.classList.remove('chatnav-fold');
	}, true);

	try {
		chrome.storage.local.get({ chatNavMuted: false }, v => {
			if (v && v.chatNavMuted) mute(true);
		});
	} catch (e) { /* storage is optional */ }

	try { document.documentElement.dataset.chatNav = ns.version; } catch (e) { /* not yet */ }
})();
