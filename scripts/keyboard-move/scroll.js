// Keyboard scrolling, so Vimium can be switched off on these sites.
//
// Not j/k. On a chess board k is the king - "Kf1", "Kxd4" - and on the xiangqi
// client j is a rank letter, so neither half of the vim pair is free. w and s
// are unused by every notation here, which is what makes them safe: they cannot
// be the start of a move on any of the three sites.
//
// Self-registering, like hints: scrolling is page navigation and must work on a
// page with no board on it.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});
	// Registered at runtime for a site that is also in the manifest would load
	// this twice, and every key would be handled twice.
	if (ns.scroll) return;

	const STEP = 64;          // one press; key repeat makes it continuous
	const MIN_SCROLLABLE = 24;

	function scrollableAncestor(node) {
		for (let el = node; el && el.nodeType === 1; el = el.parentElement) {
			const style = getComputedStyle(el);
			const scrolls = /auto|scroll|overlay/.test(style.overflowY);
			if (scrolls && el.scrollHeight - el.clientHeight > MIN_SCROLLABLE) return el;
		}
		return null;
	}

	// The biggest scrollable box actually on screen, used when the page itself
	// does not scroll - a board page is often a fixed shell around one scrolling
	// panel, and scrolling the document then does nothing at all.
	function largestScroller() {
		let best = null, bestArea = 0;
		for (const el of document.querySelectorAll('div, main, section, aside, ul, ol')) {
			if (el.scrollHeight - el.clientHeight <= MIN_SCROLLABLE) continue;
			const style = getComputedStyle(el);
			if (!/auto|scroll|overlay/.test(style.overflowY)) continue;
			const r = el.getBoundingClientRect();
			if (r.width < 80 || r.height < 80) continue;
			if (r.bottom < 0 || r.top > innerHeight) continue;
			const area = Math.min(r.width, innerWidth) * Math.min(r.height, innerHeight);
			if (area > bestArea) { best = el; bestArea = area; }
		}
		return best;
	}

	function target() {
		// Whatever the focus sits inside wins, so a focused panel scrolls rather
		// than the page behind it.
		const focused = scrollableAncestor(document.activeElement);
		if (focused) return focused;
		const doc = document.scrollingElement || document.documentElement;
		if (doc && doc.scrollHeight - doc.clientHeight > MIN_SCROLLABLE) return doc;
		return largestScroller();
	}

	function by(amount) {
		const el = target();
		if (!el) return false;
		el.scrollBy({ top: amount, behavior: 'instant' });
		return true;
	}

	function to(edge) {
		const el = target();
		if (!el) return false;
		el.scrollTo({ top: edge === 'top' ? 0 : el.scrollHeight, behavior: 'instant' });
		return true;
	}

	const KEYS = {
		s: () => by(STEP),
		w: () => by(-STEP),
		S: () => to('bottom'),
		W: () => to('top'),
	};

	ns.scroll = { by, to, target };

	function editable(node) {
		if (!node) return false;
		const tag = node.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
			node.isContentEditable === true;
	}

	function onKey(e) {
		if (e.__kbmScrollSeen) return;
		e.__kbmScrollSeen = true;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (editable(e.target)) return;
		// Hints own the keyboard while they are up, and their alphabet includes
		// both of these letters. Checked via the document flag as well, so this
		// holds even when the two end up in different worlds.
		if (ns.hints && ns.hints.isActive()) return;
		if (document.documentElement.dataset.kbmHints === '1') return;

		const action = KEYS[e.key];
		if (!action) return;
		if (!action()) return;          // nothing scrollable: leave the key alone
		e.preventDefault();
		e.stopImmediatePropagation();
	}

	const nativeAdd = EventTarget.prototype.addEventListener;
	nativeAdd.call(window, 'keydown', onKey, true);
	nativeAdd.call(document, 'keydown', onKey, true);
})();
