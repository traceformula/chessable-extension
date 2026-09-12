// Link hints: label everything clickable on screen, type a label to click it.
//
// Scoped to the sites this extension already runs on, which is what keeps it
// free: no host permission beyond what the board adapters already needed. It is
// a deliberately smaller problem than hinting the whole web - these are a
// handful of known pages rather than every site there is.
//
// Hints listen for their own key rather than being routed through main.js. They
// are page navigation, not board input, and have to work on a page with no board
// on it at all - which is exactly Chessable's outer page.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});

	// Home row first: the characters are typed blind, right after looking at a
	// label rather than at the keyboard.
	const ALPHABET = 'sadfjklewcmpgh';
	const MAX_HINTS = 250;
	const MAX_FRAME_DEPTH = 4;
	const MAX_SCANNED = 6000;
	const MARKUP = [
		'a[href]', 'button', 'select', 'textarea', 'summary', 'label[for]',
		'input:not([type="hidden"])',
		'[role="button"]', '[role="link"]', '[role="tab"]', '[role="checkbox"]',
		'[role="menuitem"]', '[role="option"]', '[onclick]',
		'[tabindex]:not([tabindex="-1"])',
		// Tagged by clickable-probe.js: the element registered a click handler in
		// code, which is the only trace an application built from bare divs leaves.
	].join(',');

	const CSS = `
.kbm-hint-layer { position: fixed; inset: 0; z-index: 2147483600; pointer-events: none; }
.kbm-hint {
	position: fixed; z-index: 2147483600;
	padding: 1px 4px 2px; border-radius: 3px;
	background: linear-gradient(#ffe36e, #f5c518);
	color: #201c00; border: 1px solid #b98900;
	font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
	letter-spacing: .5px; text-transform: uppercase;
	box-shadow: 0 1px 3px rgba(0,0,0,.4);
	white-space: nowrap;
}
.kbm-hint .kbm-hint-done { opacity: .35; }
.kbm-hint-notice {
	position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
	z-index: 2147483600; pointer-events: none;
	padding: 8px 14px; border-radius: 8px;
	background: rgba(150,40,40,.95); color: #fff;
	font: 500 13px/1.2 system-ui, -apple-system, sans-serif;
	box-shadow: 0 4px 16px rgba(0,0,0,.4);
}
`;

	let layer = null;
	let hints = [];
	let typed = '';

	function styles() {
		if (document.getElementById('kbm-hint-css')) return;
		const el = document.createElement('style');
		el.id = 'kbm-hint-css';
		el.textContent = CSS;
		(document.head || document.documentElement).appendChild(el);
	}

	// Labels are generated so that no label is a prefix of another, which is what
	// lets a match fire as soon as it is unambiguous. A collision there would be
	// silent: the shorter label fires first and the longer can never be typed.
	//
	// Widths are mixed rather than uniform, so 14 or fewer targets are one
	// keystroke each. Build by expansion: whenever there are not enough labels,
	// take the shortest and replace it with itself plus every letter. Removing a
	// label before adding its extensions is what keeps the set prefix-free.
	function labelsFor(count) {
		if (count <= 0) return [];
		let labels = ALPHABET.split('');
		while (labels.length < count) {
			const head = labels.shift();
			for (const ch of ALPHABET) labels.push(head + ch);
		}
		return labels.slice(0, count);
	}

	ns.hintLabels = labelsFor;   // exported for tests

	// Candidates carry a strength, because the three ways of spotting one are not
	// equally trustworthy:
	//
	//   markup (3)  a link, a button, an ARIA role - says what it is
	//   probe  (2)  a click handler was attached - true of rows AND of the panels
	//               holding them, since a framework marks its containers too
	//   cursor (1)  a pointer cursor - inherited, so every span inside a link has one
	//
	// Two rules follow. A candidate holding another of equal or greater strength
	// is a wrapper, not a target, so the panel yields to the row and the row to a
	// button inside it. A candidate sitting inside a stronger one is decoration,
	// so a link's icon and text yield to the link.
	const STRENGTH = { markup: 3, probe: 2, cursor: 1 };

	function hidden(style) {
		return style.visibility === 'hidden' || style.display === 'none' ||
			Number(style.opacity) === 0;
	}

	// Something painted over it - a modal, a sticky header - means a click would
	// not reach it anyway, so it should not be offered.
	function onTop(doc, el, rect, view) {
		const x = Math.min(Math.max(rect.left + rect.width / 2, 1), view.innerWidth - 1);
		const y = Math.min(Math.max(rect.top + rect.height / 2, 1), view.innerHeight - 1);
		const top = doc.elementFromPoint(x, y);
		return !!top && (top === el || el.contains(top) || top.contains(el));
	}

	// Walks same-origin frames as well as this document, translating every rect
	// into the coordinates of the frame the labels are drawn in. Chessable keeps
	// its board in an iframe, so without this a page could hint its own links or
	// the board's, never both.
	function collect(doc, dx, dy, out, depth, blocked) {
		const view = doc.defaultView;
		if (!view) return;
		let scanned = 0;
		for (const el of doc.querySelectorAll('*')) {
			if (out.length >= MAX_HINTS) return;
			if (++scanned > MAX_SCANNED) break;
			if (el.disabled) continue;
			const rect = el.getBoundingClientRect();
			if (rect.width < 4 || rect.height < 4) continue;
			if (rect.bottom < 0 || rect.right < 0) continue;
			if (rect.top > view.innerHeight || rect.left > view.innerWidth) continue;

			const style = view.getComputedStyle(el);
			if (hidden(style)) continue;

			// Two ways of being clickable. The markup list catches anything with a
			// role the page has declared; the pointer cursor catches everything
			// else, which on an application built out of plain divs - the xiangqi
			// client is compiled from Java - is the only signal there is.
			const strength = el.matches(MARKUP) ? STRENGTH.markup
				: el.hasAttribute('data-kbm-click') ? STRENGTH.probe
				: style.cursor === 'pointer' ? STRENGTH.cursor
				: 0;
			if (!strength) continue;
			// Something the size of the page is delegation, not a target.
			if (rect.width > view.innerWidth * 0.9 && rect.height > view.innerHeight * 0.6) continue;
			if (!onTop(doc, el, rect, view)) { blocked.push({ el, strength, left: rect.left + dx, top: rect.top + dy }); continue; }
			out.push({ el, strength, left: rect.left + dx, top: rect.top + dy });
		}
		if (depth >= MAX_FRAME_DEPTH) return;
		for (const frame of doc.querySelectorAll('iframe, frame')) {
			let sub = null;
			try { sub = frame.contentDocument; } catch (e) { continue; }   // cross-origin
			if (!sub || !sub.body) continue;
			const fr = frame.getBoundingClientRect();
			if (fr.width < 8 || fr.height < 8) continue;
			collect(sub, dx + fr.left, dy + fr.top, out, depth + 1, blocked);
		}
	}

	function prune(found) {
		const byEl = new Map(found.map(f => [f.el, f]));
		const drop = new Set();
		for (const f of found) {
			for (let p = f.el.parentElement; p; p = p.parentElement) {
				const ancestor = byEl.get(p);
				if (!ancestor) continue;
				if (ancestor.strength <= f.strength) drop.add(ancestor.el);
				else drop.add(f.el);
			}
		}
		return found.filter(f => !drop.has(f.el));
	}

	function render() {
		for (const hint of hints) {
			if (!hint.label.startsWith(typed)) {
				hint.node.style.display = 'none';
				continue;
			}
			hint.node.style.display = '';
			hint.node.textContent = '';
			if (typed) {
				const done = document.createElement('span');
				done.className = 'kbm-hint-done';
				done.textContent = typed;
				hint.node.appendChild(done);
			}
			hint.node.appendChild(document.createTextNode(hint.label.slice(typed.length)));
		}
	}

	function activate(el) {
		// A field wants focus, not a click; anything else gets a real click so the
		// page's own handler runs, whatever it is.
		const tag = el.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
			el.focus();
			return;
		}
		try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
		const r = el.getBoundingClientRect();
		const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
		for (const type of ['mousedown', 'mouseup', 'click']) {
			el.dispatchEvent(new MouseEvent(type, {
				bubbles: true, cancelable: true, composed: true,
				view: el.ownerDocument.defaultView,
				button: 0, buttons: type === 'mousedown' ? 1 : 0, ...at,
			}));
		}
	}

	function onScroll() { ns.hints.close(); }

	// Hints run in the extension's world, where the board overlay is not
	// available, so they carry a minimal notice of their own. Failing silently is
	// what made an empty result indistinguishable from a dead key.
	function notice(text) {
		styles();
		const el = document.createElement('div');
		el.className = 'kbm-hint-notice';
		el.textContent = text;
		(document.body || document.documentElement).appendChild(el);
		setTimeout(() => el.remove(), 1800);
	}

	ns.hints = {
		isActive() { return !!layer; },

		open() {
			this.close();
			// Ask the page-world probe to tag anything whose click handler is not
			// visible from here - GWT widgets carry theirs as a JS expando. The
			// event is delivered synchronously, so the tags are in place below.
			try {
				document.dispatchEvent(new CustomEvent('kbm-tag-clickables'));
			} catch (e) { /* no probe on this page: markup and cursor still apply */ }

			const raw = [], blocked = [];
			collect(document, 0, 0, raw, 0, blocked);
			let found = prune(raw);
			// An application may float a transparent layer over the whole page, in
			// which case the hit test rejects everything beneath it. Rather than
			// report an empty page, fall back to what was rejected for that reason
			// alone - a hint that might be covered beats no hints at all.
			if (!found.length && blocked.length) found = prune(blocked);
			if (!found.length) { notice('nothing to click here'); return 0; }

			styles();
			layer = document.createElement('div');
			layer.className = 'kbm-hint-layer';
			const labels = labelsFor(found.length);
			hints = found.map((item, i) => {
				const node = document.createElement('div');
				node.className = 'kbm-hint';
				node.style.left = Math.max(0, item.left) + 'px';
				node.style.top = Math.max(0, item.top) + 'px';
				layer.appendChild(node);
				return { el: item.el, label: labels[i], node };
			});
			(document.body || document.documentElement).appendChild(layer);
			// Flagged on the document so the board scripts can see it. They run in
			// the page's world while this runs in the extension's, so a shared
			// variable is not available to both - but the DOM is.
			document.documentElement.dataset.kbmHints = '1';
			typed = '';
			render();
			// Any scroll invalidates every position, so close rather than lie.
			addEventListener('scroll', onScroll, { capture: true, once: true });
			return hints.length;
		},

		close() {
			delete document.documentElement.dataset.kbmHints;
			removeEventListener('scroll', onScroll, { capture: true });
			if (layer) layer.remove();
			layer = null;
			hints = [];
			typed = '';
		},

		// Returns true when the key was consumed.
		handleKey(e) {
			if (!layer) return false;
			if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
			if (e.key === 'Backspace') {
				e.preventDefault();
				typed = typed.slice(0, -1);
				render();
				return true;
			}
			if (e.key.length !== 1) return false;
			const ch = e.key.toLowerCase();
			if (!ALPHABET.includes(ch)) { e.preventDefault(); this.close(); return true; }

			e.preventDefault();
			const next = typed + ch;
			const matches = hints.filter(h => h.label.startsWith(next));
			if (!matches.length) { this.close(); return true; }
			if (matches.length === 1 && matches[0].label === next) {
				const el = matches[0].el;
				this.close();
				activate(el);
				return true;
			}
			typed = next;
			render();
			return true;
		},
	};

	function editable(node) {
		if (!node) return false;
		const tag = node.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
			node.isContentEditable === true;
	}

	function onKey(e) {
		if (e.__kbmHintSeen) return;
		e.__kbmHintSeen = true;
		if (e.metaKey || e.ctrlKey || e.altKey) return;

		if (ns.hints.isActive()) {
			if (ns.hints.handleKey(e)) e.stopImmediatePropagation();
			return;
		}
		// ";" rather than Vimium's "f": on a chess board f is a file letter, so
		// taking it would break "f4" and "Nf3" outright.
		if (e.key !== ';' || editable(e.target)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		ns.hints.open();
	}

	const nativeAdd = EventTarget.prototype.addEventListener;
	nativeAdd.call(window, 'keydown', onKey, true);
	nativeAdd.call(document, 'keydown', onKey, true);
})();
