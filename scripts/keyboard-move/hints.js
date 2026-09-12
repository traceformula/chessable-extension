// Link hints: label everything clickable on screen, type a label to click it.
//
// Scoped to the sites this extension already runs on, which is what keeps it
// free: no host permission beyond what the board adapters already needed. It is
// a deliberately smaller problem than hinting the whole web - these are a
// handful of known pages rather than every site there is.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});

	// Home row first: the characters are typed blind, right after looking at a
	// label rather than at the keyboard.
	const ALPHABET = 'sadfjklewcmpgh';
	const MAX_HINTS = 250;
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
.kbm-hint .done { opacity: .35; }
`;

	let layer = null;
	let hints = [];       // { el, label, node }
	let typed = '';

	function styles() {
		if (document.getElementById('kbm-hint-css')) return;
		const el = document.createElement('style');
		el.id = 'kbm-hint-css';
		el.textContent = CSS;
		(document.head || document.documentElement).appendChild(el);
	}

	// Labels are generated so that no label is a prefix of another, which is what
	// lets a match fire as soon as it is unambiguous.
	//
	// Widths are mixed rather than uniform. A single width means 15 links on a
	// page all get two characters, when 14 of them could have had one.
	function labelsFor(count) {
		if (count <= 0) return [];
		// Build a prefix-free set by expansion: whenever there are not enough
		// labels, take the shortest one and replace it with itself plus every
		// letter. Removing a label before adding its extensions is what guarantees
		// no label is ever a prefix of another, and taking the shortest first is
		// what keeps the mix weighted towards single characters.
		let labels = ALPHABET.split('');
		while (labels.length < count) {
			const head = labels.shift();
			for (const ch of ALPHABET) labels.push(head + ch);
		}
		return labels.slice(0, count);
	}

	ns.hintLabels = labelsFor;   // exported for tests

	function visible(el, rect) {
		if (rect.width < 4 || rect.height < 4) return false;
		if (rect.bottom < 0 || rect.right < 0) return false;
		if (rect.top > innerHeight || rect.left > innerWidth) return false;
		const style = getComputedStyle(el);
		if (style.visibility === 'hidden' || style.display === 'none') return false;
		if (Number(style.opacity) === 0) return false;
		// Something painted over it - a modal, a sticky header - means clicking
		// would not reach it anyway, so it should not be offered.
		const x = Math.min(Math.max(rect.left + rect.width / 2, 1), innerWidth - 1);
		const y = Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1);
		const top = document.elementFromPoint(x, y);
		return !!top && (top === el || el.contains(top) || top.contains(el));
	}

	function candidates() {
		const found = [];
		for (const el of document.querySelectorAll(CLICKABLE)) {
			if (el.closest('.kbm-hint-layer')) continue;
			if (el.disabled) continue;
			const rect = el.getBoundingClientRect();
			if (!visible(el, rect)) continue;
			found.push({ el, rect });
			if (found.length >= MAX_HINTS) break;
		}
		return found;
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
				done.className = 'done';
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
		el.focus({ preventScroll: true });
		const r = el.getBoundingClientRect();
		const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
		for (const type of ['mousedown', 'mouseup', 'click']) {
			el.dispatchEvent(new MouseEvent(type, {
				bubbles: true, cancelable: true, composed: true, view: window,
				button: 0, buttons: type === 'mousedown' ? 1 : 0, ...at,
			}));
		}
	}

	ns.hints = {
		isActive() { return !!layer; },

		open() {
			this.close();
			const found = candidates();
			if (!found.length) return 0;

			styles();
			layer = document.createElement('div');
			layer.className = 'kbm-hint-layer';
			const labels = labelsFor(found.length);
			hints = found.map((item, i) => {
				const node = document.createElement('div');
				node.className = 'kbm-hint';
				node.style.left = Math.max(0, item.rect.left) + 'px';
				node.style.top = Math.max(0, item.rect.top) + 'px';
				layer.appendChild(node);
				return { el: item.el, label: labels[i], node };
			});
			document.body.appendChild(layer);
			typed = '';
			render();
			// Any scroll invalidates every position, so close rather than lie.
			addEventListener('scroll', onScroll, { capture: true, once: true });
			return hints.length;
		},

		close() {
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

	function onScroll() { ns.hints.close(); }
})();
