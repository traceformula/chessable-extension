// Wires keystrokes to the matcher and the site adapter.
//
// The commit rule is "prefix-unique": a move plays the moment the buffer can no
// longer become any other legal move, so "e4" costs two keystrokes and needs no
// Enter. A keystroke that would make the buffer unmatchable is rejected instead
// of appended, which keeps the buffer always resolvable.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});
	// Whichever registered adapter finds a board in this frame. Resolved lazily
	// and re-resolved if it goes away, since a site may swap its board out.
	let resolved = null;
	function adapter() {
		if (resolved && resolved.isReady()) return resolved;
		resolved = (ns.adapters || []).find(a => a.isReady()) || null;
		return resolved;
	}
	const { match, forms, canon, isComplete, isExtendable } = ns.matcher;

	ns.version = '1.23.0';

	const ACCEPTS = /^[a-hA-HNBRQKnbrqk1-8oO0xX=-]$/;

	// How long the overlay stays up, by what it is saying. A move confirmation is
	// something you already knew you did, so it can go quickly; anything you have
	// to read needs long enough to actually read it. All of them scale together
	// with the overlay setting.
	const HOLD = {
		typing: 6000,   // mid-input: the buffer must not vanish under you
		played: 2500,   // "Nf3" - confirmation of something expected
		message: 5000,  // errors and refusals, which carry a reason
		help: 20000,    // the key list, which is there to be read
	};

	function hold(kind) {
		return HOLD[kind] * settings.hudScale;
	}

	// A single character is never allowed to play a move, even when it already
	// resolves uniquely. In sparse positions one letter can be unambiguous - with
	// only one rook move available "r" alone is enough - and a move going out on
	// the first keystroke is indistinguishable from a stray keypress.
	//
	// The stronger guard is matcher.isComplete: a move also waits until a whole
	// destination square has been typed, so a half-finished square cannot commit
	// some unintended move that happens to share its prefix.
	const MIN_AUTO_KEYS = 2;

	// Settings arrive from the extension's storage by way of the isolated-world
	// bridge, since this script cannot reach chrome.storage itself. Defaults apply
	// until the first message lands, so nothing waits on it.
	const settings = { commit: 'auto', hudScale: 1, premove: false };
	const CHANNEL = 'kbm-settings';

	window.addEventListener('message', e => {
		// This filters cross-frame noise, not the page. A page script posts with
		// e.source === window exactly as the bridge does, so it can set these
		// values - and could equally overwrite __KBM outright, since a MAIN-world
		// script shares the page's global scope. That is inherent to reaching the
		// board API and is why nothing sensitive lives on this side: the settings
		// below are display and commit preferences, and chrome.storage stays in
		// the isolated world.
		if (e.source !== window) return;
		const data = e.data;
		if (!data || data.channel !== CHANNEL || !data.settings) return;
		const next = data.settings;
		if (next.commit === 'auto' || next.commit === 'enter') settings.commit = next.commit;
		const scale = Number(next.hudScale);
		if (scale > 0) settings.hudScale = scale;
		settings.premove = next.premove === true;
	});
	window.postMessage({ channel: CHANNEL + '-request' }, window.location.origin);

	function requiresEnter() {
		return settings.commit === 'enter';
	}

	let buffer = '';
	// A resolved move held back for confirmation, either because Enter is required
	// or because too few keys have been typed to auto-play. `pendingKind` says
	// whether Enter would play it now or queue it as a premove.
	let pending = null;
	let pendingKind = 'move';
	// An action that ends or alters the game, waiting on Enter. Never armed by
	// the same keystroke that performs it.
	let armed = null;
	// After a commit the user is usually still typing the rest of the move they
	// had in mind. Those leftover characters must not open a new buffer - on a
	// position where "r" alone is unique, "Rxd2" would otherwise commit early and
	// then feed "x", "d", "2" into the next move.
	let tail = null;
	let hideTimer = null;

	function editable(node) {
		if (!node) return false;
		const tag = node.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
			node.isContentEditable === true;
	}

	function reset() {
		buffer = '';
		pending = null;
		pendingKind = 'move';
		armed = null;
		tail = null;
		ns.hud.hide();
	}

	function scheduleHide(kind) {
		clearTimeout(hideTimer);
		hideTimer = setTimeout(reset, hold(kind || 'message'));
	}

	function render(result, note) {
		ns.hud.show(buffer, result, note);
		scheduleHide(result && result.state === 'none' ? 'message' : 'typing');
	}

	// Does `key` continue the move we just played? Punctuation canonicalises away
	// to nothing, so "+" after "Rb1" and "=" after "e8" are absorbed too.
	function continuesTail(key) {
		if (!tail) return false;
		return tail.forms.some(f => f.startsWith(tail.consumed + canon(key)));
	}

	function commit(move, raw) {
		buffer = '';
		pending = null;
		// Absorb the rest of the typed move straight away - the user is already
		// mid-keystroke and should not have to wait on the board to catch up.
		tail = { forms: forms(move), consumed: canon(raw) };
		ns.hud.show(move.san, { state: 'unique', candidates: [] }, '');
		scheduleHide('played');

		// play() resolves only once the position has actually changed, so a move
		// that went nowhere is reported rather than left looking successful.
		const site = adapter();
		if (!site) {
			// Loaded on a page of this site that has no board - a news article, a
			// forum thread. "?" is claimed here, so it has to be answered here too,
			// with the keys that do work.
			if (e.key === '?') {
				e.preventDefault();
				ns.hud.help([
					{ group: 'Page', rows: [
						[';', 'label everything clickable, then type a label'],
						['/', 'find text on the page and click it'],
						[['w', 's'], 'scroll up and down'],
						[['W', 'S'], 'jump to the top or bottom'],
					] },
					'No board on this page, so there is nothing to type moves at.',
				]);
				scheduleHide('help');
			}
			return;
		}
		Promise.resolve(site.play(move)).then(played => {
			if (played) return;
			tail = null;
			ns.hud.show(move.san, { state: 'none', candidates: [] }, 'not accepted');
			scheduleHide('message');
		});
	}

	// Coordinate input, for boards where a move is typed as two squares rather
	// than as notation: file, rank, file, rank - "5e5a". Used where resolving
	// notation would need a move generator we do not have, so legality is left to
	// the server exactly as it is for a mouse move.
	const COORD_FILE = /^[1-9]$/;
	const COORD_RANK = /^[a-jA-J]$/;

	function coordKey(e, site) {
		if (e.key === 'Backspace') {
			if (!buffer) return;
			e.preventDefault();
			buffer = buffer.slice(0, -1);
			if (!buffer) return reset();
			ns.hud.show(buffer.toUpperCase(), { state: 'empty', candidates: [] }, 'square');
			scheduleHide('typing');
			return;
		}

		// Squares alternate file then rank, so only one kind of character can come
		// next. A separator is allowed and ignored, so "5e-5a" reads too.
		if (e.key === '-' && buffer.length === 2) { e.preventDefault(); return; }
		const wantsFile = buffer.length % 2 === 0;
		const ok = wantsFile ? COORD_FILE.test(e.key) : COORD_RANK.test(e.key);
		if (!ok) {
			if (!/^[0-9a-zA-Z]$/.test(e.key)) return;
			e.preventDefault();
			ns.hud.show(buffer.toUpperCase(), { state: 'none', candidates: [] },
				wantsFile ? 'expecting a file, 1-9' : 'expecting a rank, A-J');
			scheduleHide('message');
			return;
		}

		e.preventDefault();
		const next = buffer + e.key.toUpperCase();

		// Reject an origin with nothing on it, rather than clicking an empty square.
		if (next.length === 2 && !site.occupied(next[0], next[1])) {
			ns.hud.show(next, { state: 'none', candidates: [] }, 'no piece there');
			scheduleHide('message');
			return;
		}

		buffer = next;
		if (buffer.length < 4) {
			ns.hud.show(buffer, { state: 'empty', candidates: [] },
				buffer.length === 2 ? 'to \u2026' : 'square');
			scheduleHide('typing');
			return;
		}

		const move = {
			fromFile: buffer[0], fromRank: buffer[1],
			toFile: buffer[2], toRank: buffer[3],
			san: buffer.slice(0, 2) + '-' + buffer.slice(2),
		};
		const label = move.san;
		buffer = '';
		ns.hud.show(label, { state: 'unique', candidates: [] }, '');
		scheduleHide('played');
		Promise.resolve(site.play(move)).then(played => {
			if (played) return;
			ns.hud.show(label, { state: 'none', candidates: [] }, 'not accepted');
			scheduleHide('message');
		});
	}

	// Premove input. Deliberately never commits by itself: the move fires the
	// instant the opponent replies, and a mistyped one cannot be taken back.
	function premoveKey(e, moves) {
		if (e.key === 'Backspace') {
			if (!buffer) return;
			e.preventDefault();
			buffer = buffer.slice(0, -1);
			pending = null;
			if (!buffer) return reset();
			render(match(buffer, moves), 'premove');
			return;
		}
		if (!ACCEPTS.test(e.key)) return;

		const next = buffer + e.key;
		const result = match(next, moves);
		if (result.state === 'none') {
			e.preventDefault();
			render({ state: 'none', candidates: [] }, 'no such premove');
			return;
		}

		e.preventDefault();
		buffer = next;
		if (result.state === 'unique') {
			pending = result.move;
			pendingKind = 'premove';
			render(result, result.move.san + ' - enter to premove');
			return;
		}
		pending = null;
		render(result, 'premove');
	}

	function onKey(e) {
		// Registered on both window and document, so whichever survives handles the
		// key and the other sees it already dealt with.
		if (e.__kbmSeen) return;
		e.__kbmSeen = true;

		if (e.metaKey || e.ctrlKey || e.altKey) return;

		// Link hints own the keyboard while they are up, and their labels are made
		// of letters that are also notation. They run in the extension's world
		// while this may run in the page's, so the flag is read off the document
		// rather than shared directly.
		if (document.documentElement.dataset.kbmHints === '1') return;

		const site = adapter();
		if (!site) {
			// Loaded on a page of this site that has no board - a news article, a
			// forum thread. "?" is claimed here, so it has to be answered here too,
			// with the keys that do work.
			if (e.key === '?') {
				e.preventDefault();
				ns.hud.help([
					{ group: 'Page', rows: [
						[';', 'label everything clickable, then type a label'],
						['/', 'find text on the page and click it'],
						[['w', 's'], 'scroll up and down'],
						[['W', 'S'], 'jump to the top or bottom'],
					] },
					'No board on this page, so there is nothing to type moves at.',
				]);
				scheduleHide('help');
			}
			return;
		}

		// Escape returns from the chat line to the board. Every other key typed in
		// a text field is the site's, so chat still works normally.
		if (site.inputMode === 'coords' && e.key === 'Escape' && editable(e.target)) {
			e.preventDefault();
			e.target.blur();
			reset();
			return;
		}
		if (editable(e.target)) return;

		if (site.inputMode === 'coords') {
			const nav = { ArrowLeft: 'back', ArrowRight: 'forward',
				ArrowUp: 'toStart', ArrowDown: 'toEnd', Home: 'toStart', End: 'toEnd' };
			if (nav[e.key]) {
				e.preventDefault();
				// This client binds the arrows itself - the right arrow moves focus
				// to chat - and stopPropagation alone does not reach a listener
				// registered on the same target.
				e.stopImmediatePropagation();
				reset();
				if (!site[nav[e.key]]()) {
					ns.hud.show('', { state: 'none', candidates: [] }, 'no navigation here');
					scheduleHide('message');
				}
				return;
			}
			if (e.key === 'Escape') {
				if (buffer || ns.hud.isOpen()) { e.preventDefault(); reset(); }
				return;
			}

			// Confirming or abandoning an armed action takes priority over anything
			// else, so the key that arms it cannot also be read as a move.
			if (armed) {
				const action = armed;
				armed = null;
				if (e.key === 'Enter') {
					e.preventDefault();
					const used = site.activateAny(action.labels);
					ns.hud.show('', { state: used ? 'unique' : 'none', candidates: [] },
						used ? action.verb : 'no ' + action.verb + ' control found');
					scheduleHide('message');
					return;
				}
				ns.hud.show('', { state: 'empty', candidates: [] }, action.verb + ' cancelled');
				scheduleHide('message');
				if (e.key === 'Escape') { e.preventDefault(); return; }
			}

			// Lobby shortcuts. A move always begins with a file digit, so a letter
			// typed with an empty buffer cannot be part of one and is free to mean
			// something else. Chat is "m" for message: "/" belongs to find, which
			// works the same way on every site.
			if (!buffer) {
				if (e.key === 'm') {
					e.preventDefault();
					const ok = site.focusChat && site.focusChat();
					if (!ok) {
						ns.hud.show('', { state: 'none', candidates: [] }, 'no chat box found');
						scheduleHide('message');
					}
					return;
				}
				const action = site.confirmed && site.confirmed[e.key.toLowerCase()];
				if (action) {
					e.preventDefault();
					armed = action;
					ns.hud.show('', { state: 'none', candidates: [] },
						action.verb + '? enter to confirm, any other key to cancel');
					scheduleHide('message');
					return;
				}

				const label = site.controls && site.controls[e.key.toLowerCase()];
				if (label) {
					e.preventDefault();
					e.stopImmediatePropagation();
					const ok = site.activate(label);
					ns.hud.show('', { state: ok ? 'unique' : 'none', candidates: [] },
						ok ? label : label + ' \u2014 not found');
					scheduleHide('message');
					return;
				}
			}
			if (e.key === '?') {
				e.preventDefault();
				ns.hud.help([
					{ group: 'Move', rows: [
						['5E5A', 'two squares \u2014 file, rank, file, rank'],
						['1-9', 'files, left to right as labelled'],
						['A-J', 'ranks, bottom to top as labelled'],
						['backspace', 'correct the last character'],
					] },
					{ group: 'Board', rows: [
						[['\u2190', '\u2192'], 'step back and forward one move'],
						[['\u2191', '\u2193'], 'jump to the first or last move'],
					] },
					{ group: 'Page', rows: [
						[';', 'label everything clickable, then type a label'],
						[['w', 's'], 'scroll up and down'],
						[['W', 'S'], 'jump to the top or bottom'],
					] },
					{ group: 'Lobby', rows: [
						['f', 'findtable'], ['r', 'rooms'], ['n', 'new tables'],
						['t', 'tables'], ['j', 'join'], ['o', 'options'],
						['m', 'type in chat'],
						['esc', 'leave chat, or clear what you typed'],
					] },
					{ group: 'Table', rows: [
						['q', 'resign'],
						['=', 'offer a draw'],
						['u', 'unsit'],
						['x', 'reset the board'],
					] },
					'Table keys ask for enter before doing anything. Lobby keys work only when no move is half-typed. Moves are checked by the server, not here.',
				]);
				scheduleHide('help');
				return;
			}
			coordKey(e, site);
			return;
		}

		// Navigation and retraction. None of these characters appear in algebraic
		// notation, so they cannot collide with a move being typed.
		const NAV = {
			ArrowLeft: 'back', ArrowRight: 'forward',
			ArrowUp: 'toStart', ArrowDown: 'toEnd',
			Home: 'toStart', End: 'toEnd',
		};
		if (NAV[e.key]) {
			// Only swallow the key if the adapter actually did something. lichess
			// binds the arrows itself and does it well, so its adapter declines and
			// the keypress carries on to the site.
			if (!site[NAV[e.key]]()) return;
			e.preventDefault();
			e.stopPropagation();
			reset();
			return;
		}

		if (e.key === 'u') {
			e.preventDefault();
			reset();
			if (site.undo()) {
				ns.hud.show('', { state: 'unique', candidates: [] }, 'took back');
			} else {
				ns.hud.show('', { state: 'none', candidates: [] },
					'nothing to take back here');
			}
			scheduleHide('message');
			return;
		}

		if (e.key === '?') {
			e.preventDefault();
			const premoves = site.supportsPremove === true;
			ns.hud.help([
				{ group: 'Move', rows: [
					[['e4', 'nf3'], 'plays as soon as it can be nothing else'],
					[['nxd4', 'nd4'], 'the x is optional'],
					[['oo', 'ooo'], 'castle short or long'],
					[['e8', 'e8n'], 'promote to a queen, or name the piece'],
					['R8xg6', 'any disambiguator that names the origin'],
					['enter', 'play the move shown'],
					[['backspace', 'esc'], 'correct, or clear'],
				] },
				{ group: 'Board', rows: [
					[['\u2190', '\u2192'], 'step back and forward one move'],
					[['\u2191', '\u2193'], 'jump to the start or end of the line'],
					['u', 'take back a move'],
				] },
				{ group: 'Page', rows: [
					[';', 'label everything clickable, then type a label'],
					['/', 'find text on the page and click it'],
					[['w', 's'], 'scroll up and down'],
					[['W', 'S'], 'jump to the top or bottom'],
				] },
				{ group: 'Premoves', rows: [[
					premoves ? (settings.premove ? 'on' : 'off') : 'n/a',
					!premoves ? 'not available on this board'
						: settings.premove
							? 'type on the opponent\u2019s turn, enter to queue'
							: 'turn on in the extension popup (toolbar icon)',
				]] },
				'A move never plays on one keystroke, nor before its destination square is complete.',
			]);
			scheduleHide('help');
			return;
		}

		if (e.key === 'Escape') {
			const queued = site.premoveQueue ? site.premoveQueue() : [];
			if (queued && queued.length) {
				e.preventDefault();
				site.cancelPremove();
				reset();
				ns.hud.show('', { state: 'none', candidates: [] }, 'premove cancelled');
				scheduleHide('message');
				return;
			}
			if (buffer || tail || pending || ns.hud.isOpen()) {
				e.preventDefault();
				reset();
			}
			return;
		}

		if (e.key === 'Enter') {
			if (!pending) return;
			e.preventDefault();
			if (pendingKind === 'premove') {
				const queued = site.premove(pending);
				ns.hud.show(pending.san,
					{ state: queued ? 'unique' : 'none', candidates: [] },
					queued ? 'premove queued' : 'premove refused');
				buffer = '';
				pending = null;
				pendingKind = 'move';
				scheduleHide('message');
				return;
			}
			commit(pending, buffer);
			return;
		}

		if (e.key === 'Backspace') {
			if (!buffer) return;
			e.preventDefault();
			buffer = buffer.slice(0, -1);
			pending = null;
			if (!buffer) return reset();
			render(match(buffer, site.legalMoves()));
			return;
		}

		if (!ACCEPTS.test(e.key)) return;

		if (!buffer && continuesTail(e.key)) {
			e.preventDefault();
			tail.consumed += canon(e.key);
			return;
		}
		tail = null;

		// Typing is only meaningful when a move would really count. Keys are never
		// swallowed here, so chess.com keeps its own shortcuts on boards we sit out.
		const status = site.status();
		if (!status.playable) {
			// The opponent's turn is exactly when a premove is typed. Off unless
			// switched on, and it never fires on its own - Enter queues it.
			if (status.reason === 'not your turn' && settings.premove && site.supportsPremove) {
				const candidates = site.premoveMoves ? site.premoveMoves() : [];
				if (candidates.length) { premoveKey(e, candidates); return; }
			}
			if (buffer) reset();
			// "not your turn" is the normal resting state and needs no commentary,
			// but a board that cannot submit at all should say so - that failure
			// used to be invisible.
			if (status.reason && status.reason !== 'not your turn') {
				ns.hud.show('', { state: 'none', candidates: [] },
					status.reason + ' - keyboard moves disabled');
				scheduleHide('message');
			}
			return;
		}

		const moves = site.legalMoves();
		if (!moves.length) {
			// Reachable on a board that has not finished setting up. Saying so beats
			// both silence and a misleading "no such move".
			ns.hud.show('', { state: 'none', candidates: [] }, 'board not ready');
			scheduleHide('message');
			return;
		}

		const next = buffer + e.key;
		const result = match(next, moves);

		if (result.state === 'none') {
			// Reject rather than absorb, so a stray key cannot poison the buffer.
			e.preventDefault();
			render({ state: 'none', candidates: [] }, 'no such move');
			return;
		}

		e.preventDefault();
		buffer = next;

		if (result.state === 'unique') {
			const safeToPlay = canon(next).length >= MIN_AUTO_KEYS &&
				isComplete(next) && !isExtendable(next, result.move, moves);
			if (requiresEnter() || !safeToPlay) {
				pending = result.move;
				pendingKind = 'move';
				render(result, result.move.san + ' - enter to play');
				return;
			}
			commit(result.move, next);
			return;
		}

		pending = null;
		render(result);
	}

	// Register through the native addEventListener rather than whatever is on the
	// prototype by now. Page scripts and other extensions do replace that method,
	// and a wrapper that drops or reorders listeners would silently cost us every
	// keystroke. Running at document_start means we capture it before most of them.
	//
	// Bound at window as well as document: window capture is the earliest point in
	// the path, which matters for keys the site also wants. chess.com closes its
	// dialogs on Escape, and a handler above us that stops propagation would take
	// the key before a document-only listener ever saw it.
	// Tells the page-navigation scripts that "?" is answered here. They run in
	// the other world on some sites, so the DOM is the only thing both can read.
	try { document.documentElement.dataset.kbmBoardScripts = '1'; } catch (e) { /* not yet */ }

	const nativeAdd = EventTarget.prototype.addEventListener;
	nativeAdd.call(window, 'keydown', onKey, true);
	nativeAdd.call(document, 'keydown', onKey, true);
})();
