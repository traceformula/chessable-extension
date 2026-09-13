// Find text and click it.
//
// The browser's own find cannot be used for this. Its highlight is not in the
// DOM, and the match only becomes a selection when the text is selectable -
// which buttons, menus and navigation almost never are. So the search is ours:
// walk the text, measure the match with a Range, and click whatever is actually
// at that point.
//
// A Range is unaffected by user-select, so measuring works on exactly the
// controls the browser's find cannot hand over. Clicking by point rather than by
// element is deliberate too: elementFromPoint returns whatever is really on top,
// the same thing a mouse would have hit.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});
	if (ns.find) return;

	const MAX_MATCHES = 100;
	const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE', 'TEXTAREA']);

	const CSS = `
.kbm-find-bar {
	position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
	z-index: 2147483600; display: flex; align-items: center; gap: 9px;
	padding: 9px 13px; border-radius: 9px;
	background: #121214; color: #f4f4f4;
	border: 1px solid rgba(255,255,255,.09);
	box-shadow: 0 10px 30px rgba(0,0,0,.5);
	font: 500 13px/1.2 system-ui, -apple-system, sans-serif;
}
.kbm-find-bar input {
	font: inherit; width: 220px; padding: 3px 2px;
	background: none; border: 0; border-bottom: 1px solid rgba(255,255,255,.25);
	color: inherit; outline: none;
}
.kbm-find-count { opacity: .55; font-size: 12px; white-space: nowrap; }
.kbm-find-hint { opacity: .4; font-size: 11.5px; white-space: nowrap; }
.kbm-find-mark {
	position: fixed; z-index: 2147483599; pointer-events: none;
	background: rgba(255,214,0,.32); border-radius: 2px;
	box-shadow: 0 0 0 1px rgba(255,214,0,.5);
}
.kbm-find-mark.current {
	background: rgba(255,145,0,.5);
	box-shadow: 0 0 0 2px rgba(255,145,0,.9);
}
`;

	let bar = null, input = null, count = null, layer = null;
	let matches = [];
	let index = 0;

	function styles() {
		if (document.getElementById('kbm-find-css')) return;
		const el = document.createElement('style');
		el.id = 'kbm-find-css';
		el.textContent = CSS;
		(document.head || document.documentElement).appendChild(el);
	}

	// Every text match, measured in the coordinates of the frame the marks are
	// drawn in, with the document that owns it so the click lands in the right one.
	function collect(doc, dx, dy, needle, out, depth) {
		const view = doc.defaultView;
		if (!view || out.length >= MAX_MATCHES) return;
		const want = needle.toLowerCase();

		const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const text = node.textContent;
				if (!text || !text.toLowerCase().includes(want)) return NodeFilter.FILTER_REJECT;
				const parent = node.parentElement;
				if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
				const style = view.getComputedStyle(parent);
				if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
				if (Number(style.opacity) === 0) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});

		let node;
		while ((node = walker.nextNode())) {
			if (out.length >= MAX_MATCHES) return;
			const lower = node.textContent.toLowerCase();
			let from = 0;
			for (;;) {
				const at = lower.indexOf(want, from);
				if (at < 0) break;
				from = at + Math.max(1, want.length);
				const range = doc.createRange();
				range.setStart(node, at);
				range.setEnd(node, at + needle.length);
				const rect = range.getBoundingClientRect();
				// A Range measures fine through user-select: none, which is why this
				// reaches controls the browser's own find cannot hand over.
				if (rect.width < 1 || rect.height < 1) continue;
				out.push({
					doc, range,
					left: rect.left + dx, top: rect.top + dy,
					width: rect.width, height: rect.height,
				});
				if (out.length >= MAX_MATCHES) return;
			}
		}

		if (depth >= 3) return;
		for (const frame of doc.querySelectorAll('iframe, frame')) {
			let sub = null;
			try { sub = frame.contentDocument; } catch (e) { continue; }   // cross-origin
			if (!sub || !sub.body) continue;
			const fr = frame.getBoundingClientRect();
			if (fr.width < 8 || fr.height < 8) continue;
			collect(sub, dx + fr.left, dy + fr.top, needle, out, depth + 1);
		}
	}

	function drawMarks() {
		layer.textContent = '';
		matches.forEach((m, i) => {
			const mark = document.createElement('div');
			mark.className = 'kbm-find-mark' + (i === index ? ' current' : '');
			mark.style.left = m.left + 'px';
			mark.style.top = m.top + 'px';
			mark.style.width = m.width + 'px';
			mark.style.height = m.height + 'px';
			layer.appendChild(mark);
		});
		count.textContent = matches.length ? (index + 1) + ' / ' + matches.length : 'no matches';
	}

	function search(needle) {
		matches = [];
		index = 0;
		if (needle.length >= 2) collect(document, 0, 0, needle, matches, 0);
		drawMarks();
	}

	function show(i) {
		if (!matches.length) return;
		index = (i + matches.length) % matches.length;
		const m = matches[index];
		// Bring it on screen before measuring again: a point outside the viewport
		// cannot be hit-tested.
		try { m.range.startContainer.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' }); }
		catch (e) { /* detached */ }
		refresh();
	}

	// Rects move when the page scrolls, so they are measured again rather than
	// remembered.
	function refresh() {
		for (const m of matches) {
			const rect = m.range.getBoundingClientRect();
			let dx = 0, dy = 0;
			if (m.doc !== document && m.doc.defaultView && m.doc.defaultView.frameElement) {
				const fr = m.doc.defaultView.frameElement.getBoundingClientRect();
				dx = fr.left; dy = fr.top;
			}
			m.left = rect.left + dx; m.top = rect.top + dy;
			m.width = rect.width; m.height = rect.height;
		}
		drawMarks();
	}

	function clickCurrent() {
		const m = matches[index];
		if (!m) return false;
		const x = m.left + m.width / 2;
		const y = m.top + m.height / 2;
		const target = m.doc.elementFromPoint(
			x - (m.doc === document ? 0 : 0), y);
		if (!target) return false;
		close();
		// Match where a real click leaves the focus. Defined by the hint engine,
		// which is loaded alongside this on every site it runs on.
		if (ns.giveFocus) ns.giveFocus(target);
		for (const type of ['mousedown', 'mouseup', 'click']) {
			target.dispatchEvent(new MouseEvent(type, {
				bubbles: true, cancelable: true, composed: true,
				view: m.doc.defaultView, button: 0,
				buttons: type === 'mousedown' ? 1 : 0,
				clientX: x, clientY: y,
			}));
		}
		return true;
	}

	function close() {
		if (bar) bar.remove();
		if (layer) layer.remove();
		bar = input = count = layer = null;
		matches = [];
		index = 0;
		removeEventListener('scroll', onScroll, true);
	}

	function onScroll() { if (bar) refresh(); }

	function open() {
		if (bar) { input.focus(); input.select(); return; }
		styles();

		layer = document.createElement('div');
		layer.className = 'kbm-find-layer';
		document.body.appendChild(layer);

		bar = document.createElement('div');
		bar.className = 'kbm-find-bar';
		input = document.createElement('input');
		input.type = 'text';
		input.placeholder = 'find and click…';
		input.spellcheck = false;
		count = document.createElement('span');
		count.className = 'kbm-find-count';
		const hint = document.createElement('span');
		hint.className = 'kbm-find-hint';
		hint.textContent = '↑↓ move · enter click · esc cancel';
		bar.append(input, count, hint);
		document.body.appendChild(bar);

		input.addEventListener('input', () => search(input.value));
		input.addEventListener('keydown', e => {
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
			if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				if (e.shiftKey) show(index - 1); else clickCurrent();
				return;
			}
			if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
				e.preventDefault(); e.stopPropagation(); show(index + 1); return;
			}
			if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
				e.preventDefault(); e.stopPropagation(); show(index - 1); return;
			}
			e.stopPropagation();   // the page does not need what is typed in here
		});

		addEventListener('scroll', onScroll, true);
		input.focus();
	}

	ns.find = { open, close, isOpen: () => !!bar };
})();
