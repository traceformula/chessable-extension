// Escape gives the keyboard back.
//
// Every shortcut in the page layer stands down while the cursor is in a text
// box, which is right - ";" typed into a search field is a semicolon. But it
// leaves no way back to the shortcuts except reaching for the mouse. Escape is
// the way back, the same gesture vim uses to leave insert mode.
//
// Two deliberate choices:
//
// The keypress is not consumed. Plenty of pages bind Escape themselves, to
// close their own dialog or cancel their own edit, and taking focus away is all
// this needs - there is no reason to take the key as well.
//
// The blur is deferred a tick, so the page handles its own Escape first, with
// focus still where it expects. An editor that answers Escape by refocusing
// itself therefore loses to us rather than the other way round.
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	root.__KBM = root.__KBM || {};
	root.__KBM.blur = api;
	if (typeof document !== 'undefined') api.install();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

	// Anything that swallows a keystroke. Checked by shape rather than by a
	// list of input types: a checkbox takes the space bar just as a text field
	// takes a letter.
	function isEditable(el) {
		if (!el) return false;
		if (el.isContentEditable) return true;
		const tag = el.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
	}

	// An event raised inside a shadow root is retargeted to the host on its way
	// out, so a listener on window sees a plain <div> where the real target is an
	// <input>. composedPath() still holds the truth for an open root. Any page
	// built out of web components hits this, not just our own command line.
	function originalTarget(e) {
		if (!e) return null;
		const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
		return path && path.length ? path[0] : e.target;
	}

	// document.activeElement stops at the shadow host for the same reason.
	function deepActive(doc) {
		let el = doc && doc.activeElement;
		while (el && el.shadowRoot && el.shadowRoot.activeElement) {
			el = el.shadowRoot.activeElement;
		}
		return el;
	}

	// The way back in, so Escape is not a one-way door. "i" is what vim uses to
	// start typing, and the thing to return to is the very box Escape left -
	// remembered rather than guessed, because the guess would be wrong on the
	// editors that need it most. Monaco, which onecompiler.com runs on, takes
	// its keystrokes through a textarea a few pixels tall; anything picking the
	// largest or the first text box on the page would never find it.
	function shouldResume(e, active) {
		if (!e || e.key !== 'i') return false;
		if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
		return !isEditable(active);
	}

	function shouldRelease(e, active) {
		if (!e || e.key !== 'Escape') return false;
		if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
		return isEditable(active);
	}

	// Sites answer Escape themselves, and some of them answer it by putting the
	// cursor straight back where it was. Releasing once is then worth nothing:
	// the box takes focus again before the next key is typed, and the shortcut
	// that key was meant for goes into the text instead.
	//
	// So the release is held briefly. For a moment afterwards, a text box that
	// takes focus back loses it again. A press of the pointer or of Tab ends the
	// hold at once - those are the user asking for that box, and the point is to
	// beat the page, never the person.
	const HOLD = 1000;
	let holdUntil = 0;
	let released = null;

	function stamp(what) {
		try { document.documentElement.dataset.kbmEsc = what; } catch (e) { /* early */ }
	}

	// Letters belong to whoever is already using them: the board scripts spell
	// moves with them, and a xiangqi file really is called "i". The hint and
	// find layers own the keyboard outright while they are up.
	function lettersAreTaken() {
		const flags = document.documentElement.dataset;
		if (flags.kbmBoardScripts === '1' || flags.kbmHints === '1') return true;
		const ns = globalThis.__KBM || {};
		if (ns.hints && ns.hints.isActive && ns.hints.isActive()) return true;
		if (ns.find && ns.find.isOpen && ns.find.isOpen()) return true;
		return false;
	}

	function stillThere(el) {
		return !!el && typeof el.focus === 'function' &&
			(el.isConnected !== false) && document.contains(el);
	}

	function install() {
		window.addEventListener('keydown', function (e) {
			if (e.key === 'Tab') { holdUntil = 0; return; }

			const active = deepActive(document);

			if (shouldResume(e, active) && !lettersAreTaken()) {
				if (!stillThere(released)) { stamp('nothing to go back to'); return; }
				e.preventDefault();
				holdUntil = 0;              // asked for, so nothing holds it off
				released.focus();
				stamp('back in ' + (released.tagName || '?').toLowerCase());
				return;
			}

			if (!shouldRelease(e, active)) {
				if (e.key === 'Escape') stamp('nothing to release');
				return;
			}

			// Now, so the next keystroke lands outside the box whatever the page
			// does with this one.
			released = active;
			if (active.blur) active.blur();
			holdUntil = Date.now() + HOLD;
			stamp('released ' + (active.tagName || '?').toLowerCase());

			// And again once the page has had its own turn with the key, for a
			// page that answers Escape by refocusing.
			setTimeout(function () {
				const now = deepActive(document);
				if (isEditable(now) && now.blur) now.blur();
			}, 0);
		}, true);

		document.addEventListener('focusin', function (e) {
			if (Date.now() > holdUntil) return;
			const el = originalTarget(e) || e.target;
			if (isEditable(el) && el.blur) { el.blur(); stamp('held off ' + (el.tagName || '?').toLowerCase()); }
		}, true);

		// The pointer always wins: clicking into a box is asking for it.
		document.addEventListener('pointerdown', function () { holdUntil = 0; }, true);
	}

	return { isEditable, shouldRelease, shouldResume, originalTarget, deepActive, install };
});
