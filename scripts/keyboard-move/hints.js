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
	const CLICKABLE = [
		'a[href]', 'button', 'select', 'textarea', 'summary', 'label[for]',
		'input:not([type="hidden"])',
		'[role="button"]', '[role="link"]', '[role="tab"]', '[role="checkbox"]',
		'[role="menuitem"]', '[role="option"]', '[onclick]',
		'[tabindex]:not([tabindex="-1"])',
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

	function visible(doc, el, rect) {
		const view = doc.defaultView;
		if (!view) return false;
		if (rect.width < 4 || rect.height < 4) return false;
		if (rect.bottom < 0 || rect.right < 0) return false;
		if (rect.top > view.innerHeight || rect.left > view.innerWidth) return false;
		const style = view.getComputedStyle(el);
		if (style.visibility === 'hidden' || style.display === 'none') return false;
		if (Number(style.opacity) === 0) return false;
		// Something painted over it - a modal, a sticky header - means a click
		// would not reach it anyway, so it should not be offered.
		const x = Math.min(Math.max(rect.left + rect.width / 2, 1), view.innerWidth - 1);
		const y = Math.min(Math.max(rect.top + rect.height / 2, 1), view.innerHeight - 1);
		const top = doc.elementFromPoint(x, y);
		return !!top && (top === el || el.contains(top) || top.contains(el));
	}

	// Walks same-origin frames as well as this document, translating every rect
	// into the coordinates of the frame the labels are drawn in. Chessable keeps
	// its board in an iframe, so without this a page could hint its own links or
	// the board's, never both.
	function collect(doc, dx, dy, out, depth) {
		for (const el of doc.querySelectorAll(CLICKABLE)) {
			if (out.length >= MAX_HINTS) return;
			if (el.closest('.kbm-hint-layer')) continue;
			if (el.disabled) continue;
			const r = el.getBoundingClientRect();
			if (!visible(doc, el, r)) continue;
			out.push({ el, left: r.left + dx, top: r.top + dy });
		}
		if (depth >= MAX_FRAME_DEPTH) return;
		for (const frame of doc.querySelectorAll('iframe, frame')) {
			let sub = null;
			try { sub = frame.contentDocument; } catch (e) { continue; }   // cross-origin
			if (!sub || !sub.body) continue;
			const fr = frame.getBoundingClientRect();
			if (fr.width < 8 || fr.height < 8) continue;
			collect(sub, dx + fr.left, dy + fr.top, out, depth + 1);
		}
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

	ns.hints = {
		isActive() { return !!layer; },

		open() {
			this.close();
			const found = [];
			collect(document, 0, 0, found, 0);
			if (!found.length) return 0;

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
