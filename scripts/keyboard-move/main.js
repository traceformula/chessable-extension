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

	ns.version = '1.3.1';

	const ACCEPTS = /^[a-hA-HNBRQKnbrqk1-8oO0xX=-]$/;
	const IDLE_HIDE_MS = 1400;

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

	function scheduleHide() {
		clearTimeout(hideTimer);
		hideTimer = setTimeout(reset, IDLE_HIDE_MS);
	}

	function render(result, note) {
		ns.hud.show(buffer, result, note);
		scheduleHide();
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
		scheduleHide();

		// play() resolves only once the position has actually changed, so a move
		// that went nowhere is reported rather than left looking successful.
		Promise.resolve(adapter.play(move)).then(played => {
			if (played) return;
			tail = null;
			ns.hud.show(move.san, { state: 'none', candidates: [] }, 'not accepted');
			scheduleHide();
		});
	}

	function onKey(e) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (editable(e.target)) return;
		if (!adapter.isReady()) return;

		if (e.key === 'Escape') {
			if (buffer || tail) { e.preventDefault(); reset(); }
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
				scheduleHide();
			}
			return;
		}

		const moves = adapter.legalMoves();
		if (!moves.length) {
			// Reachable on a board that has not finished setting up. Saying so beats
			// both silence and a misleading "no such move".
			ns.hud.show('', { state: 'none', candidates: [] }, 'board not ready');
			scheduleHide();
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
