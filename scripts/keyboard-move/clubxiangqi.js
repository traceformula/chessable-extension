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
	function clickAt(point) {
		const target = document.elementFromPoint(point.x, point.y);
		if (!target) return false;
		const base = {
			bubbles: true, cancelable: true, composed: true, view: window,
			clientX: point.x, clientY: point.y, button: 0,
		};
		for (const type of ['mousedown', 'mouseup', 'click']) {
			target.dispatchEvent(new MouseEvent(type, {
				...base, buttons: type === 'mousedown' ? 1 : 0,
			}));
		}
		return true;
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

		// Not available: the client exposes no navigation, takeback or premove.
		status() { return geometry() ? { playable: true, reason: null } : { playable: false, reason: 'no board' }; },
		isMyTurn() { return this.status().playable; },
		legalMoves() { return []; },
		back() { return false; },
		forward() { return false; },
		toStart() { return false; },
		toEnd() { return false; },
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
