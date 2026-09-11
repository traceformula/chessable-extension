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

	ns.version = '1.2.4';

	const ACCEPTS = /^[a-hA-HNBRQKnbrqk1-8oO0xX=-]$/;
	const IDLE_HIDE_MS = 1400;

	let buffer = '';
	// After an early commit the user is usually still typing the rest of the move
	// they had in mind. Those leftover characters must not open a new buffer - on
	// a position where "r" alone is unique, "Rxd2" would otherwise commit on "r"
	// and then feed "x", "d", "2" into the next move. While `tail` is set we
	// silently swallow anything that still spells the move just played.
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
		const next = tail.consumed + canon(key);
		return tail.forms.some(f => f.startsWith(next));
	}

	function commit(move, raw) {
		const before = adapter.fen();
		const played = adapter.play(move);
		buffer = '';
		tail = played ? { forms: forms(move), consumed: canon(raw) } : null;
		ns.hud.show(move.san, { state: 'unique', candidates: [] }, played ? '' : 'rejected');
		scheduleHide();

		// The call not throwing only means it was accepted, not that anything
		// happened. Check afterwards and say so, rather than leaving a move that
		// silently went nowhere looking successful.
		if (played && before) {
			adapter.confirm(move, before).then(moved => {
				if (!moved) {
					ns.hud.show(move.san, { state: 'none', candidates: [] }, 'not accepted');
					scheduleHide();
				}
			});
		}
	}

	function onKey(e) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (editable(e.target)) return;
		if (!adapter.isReady()) return;

		if (e.key === 'Escape') {
			if (buffer || tail) { e.preventDefault(); reset(); }
			return;
		}

		if (e.key === 'Backspace') {
			if (!buffer) return;
			e.preventDefault();
			buffer = buffer.slice(0, -1);
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

		if (result.state === 'unique') {
			commit(result.move, next);
			return;
		}

		buffer = next;
		render(result);
	}

	// Register through the native addEventListener rather than whatever is on the
	// prototype by now. Page scripts and other extensions do replace that method,
	// and a wrapper that drops or reorders listeners would silently cost us every
	// keystroke. Running at document_start means we capture it before most of them.
	const nativeAdd = EventTarget.prototype.addEventListener;
	nativeAdd.call(document, 'keydown', onKey, true);
})();
