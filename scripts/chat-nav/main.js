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
	ns.version = '1.31.1';
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

	function domTurns() {
		const found = firstMatch(site.user);
		if (!found) return [];
		return found.elements.map((el, i) => ({
			n: i + 1, el, text: label(el.textContent),
		}));
	}

	function rowEls() {
		return site.row ? Array.from(document.querySelectorAll(site.row)) : [];
	}

	// How many rows the transcript has in total, not how many are in the page.
	// Each rendered row knows its own index and its distance from the end, and
	// the two together name the length of the whole thing.
	function domTotal() {
		let total = 0;
		for (const row of rowEls()) {
			const index = Number(row.dataset.index);
			const fromTail = Number(row.dataset.perfRowFromTail);
			if (!isNaN(index) && !isNaN(fromTail)) {
				total = Math.max(total, index + fromTail + 1);
			}
		}
		return total;
	}

	function virtualized() {
		if (site.spacer) {
			const spacer = document.querySelector(site.spacer);
			if (spacer && spacer.getBoundingClientRect().height > 1) return true;
		}
		return !!(site.placeholder && document.querySelector(site.placeholder));
	}

	function scroller() {
		const anchor = document.querySelector(site.row || site.user[0]);
		for (let node = anchor && anchor.parentElement; node; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (/auto|scroll/.test(style.overflowY) &&
				node.scrollHeight > node.clientHeight + 50) return node;
		}
		return null;
	}

	// The whole conversation where the site will tell us, the rendered part
	// otherwise. `complete` says which, so nothing ever reports a count it
	// cannot stand behind.
	async function allTurns() {
		for (const api of [ns.claudeApi, ns.chatgptApi]) {
			if (!api || !api.supports()) continue;
			let loaded = null;
			try { loaded = await api.load(domTotal() || null); } catch (e) { loaded = null; }
			if (loaded && loaded.turns.length) {
				return {
					complete: true,
					total: loaded.total,
					turns: loaded.turns.map((turn, i) => ({
						n: i + 1, row: turn.row, id: turn.id || null, text: label(turn.text),
					})),
				};
			}
		}
		return { complete: !virtualized(), total: domTotal(), turns: domTurns() };
	}

	// ChatGPT gives every message an id and puts it on the rendered element, so
	// a turn can be found without knowing where it sits. Only useful while the
	// turn is mounted: there is no seeking to one that is not, since nothing in
	// the page says where it would go.
	function byMessageId(id) {
		if (!id || !/^[\w-]{1,64}$/.test(id)) return null;
		return document.querySelector('[data-message-id="' + id + '"]');
	}

	// Which mounted row is actually in front of the viewport.
	//
	// Not the lowest or highest index mounted: the last few rows of a
	// conversation stay mounted wherever you are, so min and max together span
	// almost the whole transcript and would say we are already where we want to
	// be. What is on screen is the only honest answer to "where am I".
	function rowInView(sc) {
		const middle = sc.getBoundingClientRect().top + sc.clientHeight / 2;
		let best = null, bestDistance = Infinity;
		for (const row of rowEls()) {
			const box = row.getBoundingClientRect();
			const distance = Math.abs((box.top + box.bottom) / 2 - middle);
			if (distance < bestDistance) { bestDistance = distance; best = row; }
		}
		return best ? Number(best.dataset.index) : null;
	}

	// Bring a row that is not in the page into it.
	//
	// Two things make this work, and it does nothing without either. Moving
	// scrollTop does not tell the virtualizer anything - it renders from its own
	// scroll handler, and an assignment does not run it - so the event is
	// dispatched by hand afterwards. And the correction is measured from the row
	// actually on screen, then applied as a proportion of the average row
	// height, which lands on the first attempt in practice.
	async function seek(row, total) {
		const sc = scroller();
		if (!sc || !site.row) return null;
		const exact = () => document.querySelector(site.row + '[data-index="' + row + '"]');

		let hit = exact();
		if (hit) return hit;

		const count = Math.max(total || domTotal(), 1);
		const perRow = Math.max(1, sc.scrollHeight / count);
		let target = (row / count) * (sc.scrollHeight - sc.clientHeight);

		for (let attempt = 0; attempt < 12; attempt++) {
			sc.scrollTop = Math.max(0, Math.min(target, sc.scrollHeight));
			sc.dispatchEvent(new Event('scroll', { bubbles: true }));
			await new Promise(r => setTimeout(r, 250));

			hit = exact();
			if (hit) return hit;

			const here = rowInView(sc);
			if (here === null) break;
			target = sc.scrollTop + (row - here) * perRow;
		}
		return null;
	}

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

	async function jump(which) {
		const found = await allTurns();
		if (!found.turns.length) {
			say('no turns found - selectors may have moved (:h)');
			return;
		}
		const turn = which === 'last'
			? found.turns[found.turns.length - 1]
			: found.turns[which - 1];
		if (!turn) {
			say('only ' + found.turns.length + ' turn' +
				(found.turns.length === 1 ? '' : 's'));
			return;
		}

		let el = turn.el || byMessageId(turn.id);
		if (!el && typeof turn.row === 'number' && site.row) {
			say('finding turn ' + turn.n + '\u2026');
			el = await seek(turn.row, found.total);
		}
		if (!el) {
			say('turn ' + turn.n + ' is not loaded - scroll to it: ' + turn.text);
			return;
		}
		el.scrollIntoView({ block: 'center', behavior: 'smooth' });
		flash(el);
		say(turn.n + '/' + found.turns.length + '  ' + turn.text);
	}

	async function list() {
		const found = await allTurns();
		const all = found.turns;
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
				closePanel();
				jump(turn.n);
			});
			return row;
		});
		// A count taken from the rendered rows alone is a count of what happens
		// to be on screen, so it is labelled as such rather than passed off as
		// the length of the conversation.
		const heading = found.complete
			? all.length + ' turns  ·  :N to jump, :q to close'
			: found.total
				? all.length + ' shown, ' + found.total + ' rows in this chat  ·  ' +
				  'the rest is not loaded'
				: all.length + ' shown  ·  only part of this chat is loaded, ' +
				  'and the page will not say how much';
		renderPanel(heading, rows);
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
			(found ? found.elements.length + ' rows in page via ' + found.selector +
			         (virtualized() ? ' (of ' + domTotal() + ', rest not loaded)' : '')
			       : 'NO TURNS MATCHED - selectors need updating'),
			[jumpRow].concat(rows));
		say('');
	}

	async function run(text) {
		const result = parse(text);
		switch (result.kind) {
			case 'none': break;
			case 'jump': await jump(result.turn); break;
			case 'ls': await list(); break;
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
			run(text).catch(function () { say('that did not work'); });
			// The bar stays up: ":ls" then ":7" is the whole point, and vim
			// leaves you on the command line between counted jumps too.
			return;
		}
		if (e.key === 'Backspace' && !input.value) {
			e.preventDefault();
			closeBar();
		}
	}

	// document.activeElement stops at a shadow host, and an event from inside one
	// is retargeted to it, so both have to be followed inward to find the real
	// text box. Our own command line lives in a shadow root, and so do the
	// controls on any page built out of web components.
	function deepActive() {
		let el = document.activeElement;
		while (el && el.shadowRoot && el.shadowRoot.activeElement) {
			el = el.shadowRoot.activeElement;
		}
		return el;
	}

	function keyTarget(e) {
		const path = e && typeof e.composedPath === 'function' ? e.composedPath() : null;
		return path && path.length ? path[0] : (e && e.target);
	}

	function editable(el) {
		if (!el) return false;
		if (el.isContentEditable) return true;
		const tag = el.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
	}

	// An event raised inside our shadow root is retargeted to the host on its
	// way out, which is how we tell the command line's own keystrokes from the
	// page's. Without this a colon typed into the command line would be read as
	// a fresh ":" and clear what had been typed so far.
	function fromOurUi(e) {
		return !!host && e.target === host;
	}

	function onKey(e) {
		if (e.defaultPrevented || fromOurUi(e)) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;

		if (e.key === 'Escape') {
			if (e.shiftKey) return;
			const active = deepActive();
			if (editable(active)) {
				// Give the keyboard back, the way vim leaves insert mode. The key
				// itself is left alone, since both sites bind Escape themselves,
				// and the blur waits a tick so that a composer answering Escape by
				// refocusing itself loses to us rather than the other way round.
				setTimeout(function () {
					if (deepActive() === active && active.blur) active.blur();
				}, 0);
				return;
			}
			if (panel && !panel.hidden) closePanel();
			return;
		}

		// Shift is not excluded above: ":" needs it on most layouts.
		if (e.key !== ':') return;
		// Never while they are writing a prompt - a colon belongs in the text.
		if (editable(keyTarget(e)) || editable(deepActive())) return;
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
