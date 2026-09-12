// Notes which elements have a click handler, so hints can find them.
//
// Some applications give nothing away in their markup. The xiangqi client is
// compiled from Java: its table rows are bare divs with no href, no role, no
// tabindex, and not even a pointer cursor - clickable only because a listener
// was attached in code. Attaching that listener is itself observable.
//
// Nothing here writes to the DOM while the page is running. An earlier version
// tagged the element from inside addEventListener, which broke YouTube outright:
// web components routinely call addEventListener in their constructor, and the
// Custom Elements spec forbids setting an attribute there, so the upgrade failed
// and the app never finished rendering. Elements are recorded in a WeakSet
// instead, and turned into attributes only when hints ask - after construction,
// briefly, and cleared again immediately.
(function () {
	const ATTR = 'data-kbm-click';
	const INTERESTING = new Set(['click', 'mousedown', 'mouseup', 'pointerdown']);
	const MARKERS = ['__listener', '__eventBits', '__gwt_resolve'];

	const proto = EventTarget && EventTarget.prototype;
	if (!proto || !proto.addEventListener || proto.__kbmProbed) return;

	const clickable = new WeakSet();
	const original = proto.addEventListener;

	proto.addEventListener = function (type, listener, options) {
		try {
			// Elements only. A listener on document or window is delegation, and
			// counting those would make the whole page one target.
			if (INTERESTING.has(type) && this instanceof Element) clickable.add(this);
		} catch (e) { /* never let bookkeeping break the page's own wiring */ }
		return original.call(this, type, listener, options);
	};

	try {
		Object.defineProperty(proto, '__kbmProbed', { value: true, enumerable: false });
	} catch (e) { /* sealed prototype: the wrapper is still in place */ }

	// Frameworks that dispatch centrally never pass an element to
	// addEventListener at all - GWT marks each widget with a __listener expando
	// instead. Those are ordinary JavaScript properties, invisible from the
	// extension's world, so they have to be read here.
	function isClickable(el) {
		if (clickable.has(el)) return true;
		if (typeof el.onclick === 'function') return true;
		for (const key of MARKERS) {
			if (el[key] != null) return true;
		}
		return false;
	}

	let tagged = [];

	function tag() {
		untag();
		for (const el of document.querySelectorAll('*')) {
			if (el.hasAttribute(ATTR)) continue;
			if (!isClickable(el)) continue;
			try { el.setAttribute(ATTR, ''); tagged.push(el); } catch (e) { /* skip */ }
		}
	}

	function untag() {
		for (const el of tagged) {
			try { el.removeAttribute(ATTR); } catch (e) { /* gone from the document */ }
		}
		tagged = [];
	}

	document.addEventListener('kbm-tag-clickables', () => {
		try { tag(); } catch (e) { /* a page that breaks this still gets hints */ }
	});
	document.addEventListener('kbm-untag-clickables', () => {
		try { untag(); } catch (e) { /* nothing to undo */ }
	});
})();
