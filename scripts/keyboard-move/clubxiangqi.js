// clubxiangqi.com adapter, for the CXQ web client.
//
// Nothing here talks to the page's JavaScript. The client is a GWT application -
// Java compiled to obfuscated JavaScript - and exposes no usable API: `window.cxq`
// is null and every symbol is minified. What it does have is a plain DOM board:
// absolutely positioned <img> pieces on a 9x10 grid, and text labels for the
// files and ranks.
//
// So this adapter reads geometry from the labels and plays by clicking squares,
// which is what a mouse does. Legality is left entirely to the server. That is
// why input here is coordinates rather than notation: resolving "C2.5" would mean
// writing a xiangqi move generator - horse-leg and elephant-eye blocking, cannon
// screens, palace, river, flying general - and naming both squares needs none of
// it.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});

	function safe(fn, fallback) {
		try { return fn(); } catch (e) { return fallback; }
	}

	const FILE = /^[1-9]$/;
	const RANK = /^[A-J]$/;

	// The board is the largest gwt-Image; the pieces are its siblings.
	function boardImage() {
		let best = null;
		for (const img of document.querySelectorAll('img.gwt-Image')) {
			const r = img.getBoundingClientRect();
			if (r.width < 200 || r.height < 200) continue;
			if (!best || r.width > best.getBoundingClientRect().width) best = img;
		}
		return best;
	}

	// Maps label -> grid index, read from the board's own coordinates rather than
	// assumed, so a board drawn from the other side still resolves correctly.
	function geometry() {
		const img = boardImage();
		if (!img || !img.parentElement) return null;
		const host = img.parentElement;
		const hr = host.getBoundingClientRect();
		if (hr.width < 200 || hr.height < 200) return null;

		const cw = hr.width / 9, ch = hr.height / 10;
		const files = new Map(), ranks = new Map();
		const scope = host.parentElement || host;

		for (const el of scope.querySelectorAll('*')) {
			if (el.children.length) continue;
			const text = (el.textContent || '').trim();
			const isFile = FILE.test(text), isRank = RANK.test(text);
			if (!isFile && !isRank) continue;
			const r = el.getBoundingClientRect();
			if (!r.width && !r.height) continue;
			if (isFile) {
				const col = Math.round((r.left + r.width / 2 - hr.left - cw / 2) / cw);
				if (col >= 0 && col < 9) files.set(text, col);
			} else {
				const row = Math.round((r.top + r.height / 2 - hr.top - ch / 2) / ch);
				if (row >= 0 && row < 10) ranks.set(text, row);
			}
		}
		if (files.size !== 9 || ranks.size !== 10) return null;
		return { hr, cw, ch, files, ranks };
	}

	// Viewport point at the centre of a square, e.g. ("5", "E").
	function pointOf(geo, file, rank) {
		const col = geo.files.get(file), row = geo.ranks.get(rank);
		if (col === undefined || row === undefined) return null;
		return {
			x: geo.hr.left + geo.cw * (col + 0.5),
			y: geo.hr.top + geo.ch * (row + 0.5),
		};
	}

	function pieceAt(geo, point) {
		for (const img of document.querySelectorAll('img.gwt-Image')) {
			const r = img.getBoundingClientRect();
			if (r.width > geo.cw * 1.5) continue;          // the board itself
			if (point.x >= r.left && point.x <= r.right &&
				point.y >= r.top && point.y <= r.bottom) return img;
		}
		return null;
	}

	// GWT wires ordinary DOM handlers, so a synthesised click is indistinguishable
	// from a real one - there is no isTrusted check to get past.
	function clickElement(target, point) {
		if (!target) return false;
		const r = target.getBoundingClientRect();
		const at = point || { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		const base = {
			bubbles: true, cancelable: true, composed: true, view: window,
			clientX: at.x, clientY: at.y, button: 0,
		};
		for (const type of ['mousedown', 'mouseup', 'click']) {
			target.dispatchEvent(new MouseEvent(type, {
				...base, buttons: type === 'mousedown' ? 1 : 0,
			}));
		}
		return true;
	}

	function clickAt(point) {
		return clickElement(document.elementFromPoint(point.x, point.y), point);
	}

	// The client's own move-navigation controls, identified by the labels it
	// draws on them. A GWT build leaves no id or stable class to match instead.
	const NAV_LABEL = { toStart: '<<', back: '<', forward: '>', toEnd: '>>' };

	function labelled(text, scope) {
		for (const el of (scope || document).querySelectorAll('button, a, div, span, td')) {
			if (el.children.length) continue;
			if ((el.textContent || '').trim() !== text) continue;
			const r = el.getBoundingClientRect();
			if (r.width < 8 || r.height < 8) continue;   // not painted
			return el;
		}
		return null;
	}

	// Locate the control strip before looking for a single chevron in it.
	//
	// "<" and ">" are one character and turn up all over a page - the first match
	// in document order was landing in the chat panel, so pressing the right arrow
	// moved focus there instead of stepping a move. The doubled "<<" and ">>" are
	// far more distinctive, so the strip is found from those and the single
	// chevrons are then only looked for inside it.
	function navGroup() {
		const first = labelled('<<');
		const last = labelled('>>');
		if (!first || !last) return null;
		let node = first;
		while (node && !node.contains(last)) node = node.parentElement;
		return node;
	}

	function navButton(which) {
		const scope = navGroup();
		if (!scope) return null;
		return labelled(NAV_LABEL[which], scope);
	}

	// Everything that looks like a control: a leaf element, drawn, with a short
	// label on it. The client is compiled from Java and its buttons are plain
	// divs, so there is nothing better to go on than the text.
	function candidates() {
		const out = [];
		for (const el of document.querySelectorAll('button, a, div, span, td, th')) {
			if (el.children.length) continue;
			const text = (el.textContent || '').trim();
			if (!text || text.length > 24) continue;
			const r = el.getBoundingClientRect();
			if (r.width < 8 || r.height < 8) continue;
			if (r.bottom < 0 || r.top > innerHeight) continue;
			out.push({ el, text });
		}
		return out;
	}

	// Exact match first, then case-insensitive, then a whole-word match inside a
	// longer label - "Unsit" should still be found on a button reading "Unsit
	// table". Anything looser would start matching prose.
	function control(label) {
		const list = candidates();
		const wanted = label.toLowerCase();
		for (const c of list) if (c.text === label) return c.el;
		for (const c of list) if (c.text.toLowerCase() === wanted) return c.el;
		const word = new RegExp('(^|\\W)' + wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\W)', 'i');
		for (const c of list) if (word.test(c.text)) return c.el;
		return null;
	}

	// What is actually on screen, so a name that does not match can be corrected
	// rather than guessed at again.
	function controlLabels(limit) {
		const seen = new Set();
		for (const c of candidates()) {
			if (!seen.has(c.text)) seen.add(c.text);
			if (seen.size >= (limit || 10)) break;
		}
		return [...seen];
	}

	function chatInput() {
		const fields = document.querySelectorAll('input[type="text"], input:not([type]), textarea');
		for (const el of fields) {
			const hint = ((el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
			if (hint.includes('chat') || hint.includes('message')) return el;
		}
		// Fall back to the widest visible text field, which is the chat line.
		let best = null, width = 0;
		for (const el of fields) {
			if (el.type === 'password') continue;
			const r = el.getBoundingClientRect();
			if (r.width > width && r.height > 8) { best = el; width = r.width; }
		}
		return best;
	}

	function navigate(which) {
		const el = navButton(which);
		return el ? clickElement(el) : false;
	}

	ns.clubxiangqi = {
		name: 'clubxiangqi',
		// Squares are typed outright, so there is no notation to match against.
		inputMode: 'coords',
		supportsPremove: false,

		isReady() {
			return !!geometry();
		},

		squares() {
			const geo = geometry();
			if (!geo) return null;
			return { files: [...geo.files.keys()].sort(), ranks: [...geo.ranks.keys()].sort() };
		},

		// Is there something to pick up on this square? Catches a mistyped origin
		// before two clicks land somewhere meaningless.
		occupied(file, rank) {
			const geo = geometry();
			if (!geo) return false;
			const point = pointOf(geo, file, rank);
			return !!point && !!pieceAt(geo, point);
		},

		async play(move) {
			const geo = geometry();
			if (!geo) return false;
			const from = pointOf(geo, move.fromFile, move.fromRank);
			const to = pointOf(geo, move.toFile, move.toRank);
			if (!from || !to) return false;

			const before = pieceAt(geo, from);
			if (!clickAt(from)) return false;
			await new Promise(r => setTimeout(r, 40));
			if (!clickAt(to)) return false;
			await new Promise(r => setTimeout(r, 260));

			// The server decides. Treat the origin emptying as the move landing;
			// anything else is reported rather than assumed.
			const after = pieceAt(geometry() || geo, from);
			return !after || after !== before;
		},

		status() { return geometry() ? { playable: true, reason: null } : { playable: false, reason: 'no board' }; },
		isMyTurn() { return this.status().playable; },
		legalMoves() { return []; },

		// Navigation drives the client's own << < > >> controls.
		back() { return navigate('back'); },
		forward() { return navigate('forward'); },
		toStart() { return navigate('toStart'); },
		toEnd() { return navigate('toEnd'); },

		// Lobby shortcuts. The labels are the client's own; press a key with no
		// move half-typed and the matching control is clicked.
		controls: {
			f: 'FINDTABLE', r: 'rooms', n: 'new tables',
			t: 'tables', j: 'Join!', o: 'Options',
		},

		// Actions that end or alter the game, and so are never one keystroke away.
		// The label the client uses is not known for certain from the outside, so
		// each lists the plausible spellings and the first one present wins.
		confirmed: {
			q: { verb: 'resign', labels: ['Resign', 'Resign!', 'resign'] },
			'=': { verb: 'offer a draw', labels: ['Draw', 'Offer Draw', 'draw', 'Request Draw'] },
			u: { verb: 'unsit', labels: ['Unsit', 'unsit', 'Unsit!', 'Stand', 'Stand Up', 'Leave'] },
			x: { verb: 'reset the board', labels: ['Reset', 'reset', 'Reset!', 'Reset Board', 'New'] },
		},

		activate(label) {
			const el = control(label);
			return el ? clickElement(el) : false;
		},

		activateAny(labels) {
			for (const label of labels) {
				const el = control(label);
				if (el) { clickElement(el); return label; }
			}
			return null;
		},

		labels(limit) { return controlLabels(limit); },

		focusChat() {
			const el = chatInput();
			if (!el) return false;
			el.focus();
			return document.activeElement === el;
		},

		// No takeback or premove: the client offers neither.
		canUndo() { return false; },
		undo() { return false; },
		premoveMoves() { return []; },
		premove() { return false; },
		cancelPremove() { return false; },
		premoveQueue() { return []; },
		fen() { return null; },
	};

	(ns.adapters = ns.adapters || []).push(ns.clubxiangqi);
})();
