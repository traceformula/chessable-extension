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

	function shouldRelease(e, active) {
		if (!e || e.key !== 'Escape') return false;
		if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
		return isEditable(active);
	}

	function install() {
		window.addEventListener('keydown', function (e) {
			const active = deepActive(document);
			if (!shouldRelease(e, active)) return;
			setTimeout(function () {
				// Only if the page has not already moved focus somewhere itself.
				if (deepActive(document) === active && active.blur) active.blur();
			}, 0);
		}, true);
	}

	return { isEditable, shouldRelease, originalTarget, deepActive, install };
});
