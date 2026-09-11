// Wires keystrokes to the matcher and the site adapter.
//
// The commit rule is "prefix-unique": a move plays the moment the buffer can no
// longer become any other legal move, so "e4" costs two keystrokes and needs no
// Enter. A keystroke that would make the buffer unmatchable is rejected instead
// of appended, which keeps the buffer always resolvable.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});
	const adapter = ns.chesscom;
	const { match, forms, canon } = ns.matcher;

	ns.version = '1.4.2';

	const ACCEPTS = /^[a-hA-HNBRQKnbrqk1-8oO0xX=-]$/;

	// How long the overlay stays up, by what it is saying. A move confirmation is
	// something you already knew you did, so it can go quickly; anything you have
	// to read needs long enough to actually read it. Scale all of them with
	// localStorage.setItem('kbm.hud.scale', '2') to slow the whole thing down.
	const HOLD = {
		typing: 6000,   // mid-input: the buffer must not vanish under you
		played: 2500,   // "Nf3" - confirmation of something expected
		message: 5000,  // errors and refusals, which carry a reason
		help: 20000,    // the key list, which is there to be read
	};

	function hold(kind) {
		let scale = 1;
		try {
			const raw = parseFloat(localStorage.getItem('kbm.hud.scale'));
			if (raw > 0) scale = raw;
		} catch (e) { /* storage blocked: default timing */ }
		return HOLD[kind] * scale;
	}

	// A single character is never allowed to play a move, even when it already
	// resolves uniquely. In sparse positions one letter can be unambiguous - with
	// only one rook move available "r" alone is enough - and a move going out on
	// the first keystroke is indistinguishable from a stray keypress.
	const MIN_AUTO_KEYS = 2;

	// Opt in with localStorage.setItem('kbm.commit', 'enter') to require Enter for
	// every move instead of playing as soon as the input is unambiguous.
	function requiresEnter() {
		try { return localStorage.getItem('kbm.commit') === 'enter'; }
		catch (e) { return false; }
	}

	let buffer = '';
	// A resolved move held back for confirmation, either because Enter is required
	// or because too few keys have been typed to auto-play.
	let pending = null;
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
		Promise.resolve(adapter.play(move)).then(played => {
			if (played) return;
			tail = null;
			ns.hud.show(move.san, { state: 'none', candidates: [] }, 'not accepted');
			scheduleHide('message');
		});
	}

	function onKey(e) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (editable(e.target)) return;
		if (!adapter.isReady()) return;

		// Navigation and retraction. None of these characters appear in algebraic
		// notation, so they cannot collide with a move being typed.
		const NAV = {
			ArrowLeft: 'back', ArrowRight: 'forward',
			ArrowUp: 'toStart', ArrowDown: 'toEnd',
			Home: 'toStart', End: 'toEnd',
		};
		if (NAV[e.key]) {
			e.preventDefault();
			e.stopPropagation();
			reset();
			adapter[NAV[e.key]]();
			return;
		}

		if (e.key === 'u') {
			e.preventDefault();
			reset();
			if (adapter.undo()) {
				ns.hud.show('', { state: 'unique', candidates: [] }, 'took back');
			} else {
				ns.hud.show('', { state: 'none', candidates: [] },
					'no undo here - use the board takeback');
			}
			scheduleHide('message');
			return;
		}

		if (e.key === '?') {
			e.preventDefault();
			ns.hud.show('', { state: 'empty', candidates: [] },
				'type a move  \u00b7  \u2190\u2192 step  \u2191\u2193 start/end  \u00b7  u undo  \u00b7  esc clear');
			scheduleHide('help');
			return;
		}

		// Escape dismisses whatever is on screen, not just a half-typed move. The
		// overlay itself is the usual reason to press it - help sits there for
		// twenty seconds - and that case has no buffer to clear. The keypress is
		// only swallowed when we actually had something to dismiss, so chess.com
		// keeps Escape for closing its own dialogs.
		if (e.key === 'Escape') {
			if (buffer || tail || pending || ns.hud.isOpen()) {
				e.preventDefault();
				reset();
			}
			return;
		}

		if (e.key === 'Enter') {
			if (!pending) return;
			e.preventDefault();
			commit(pending, buffer);
			return;
		}

		if (e.key === 'Backspace') {
			if (!buffer) return;
			e.preventDefault();
			buffer = buffer.slice(0, -1);
			pending = null;
			if (!buffer) return reset();
			render(match(buffer, adapter.legalMoves()));
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
		const status = adapter.status();
		if (!status.playable) {
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

		const moves = adapter.legalMoves();
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
			if (requiresEnter() || canon(next).length < MIN_AUTO_KEYS) {
				pending = result.move;
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
	const nativeAdd = EventTarget.prototype.addEventListener;
	nativeAdd.call(document, 'keydown', onKey, true);
})();
