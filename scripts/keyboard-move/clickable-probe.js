// Marks elements that register a click handler, so hints can find them.
//
// Some applications give nothing away in their markup. The xiangqi client is
// compiled from Java: its table rows are bare divs with no href, no role, no
// tabindex, and not even a pointer cursor - they are clickable only because a
// listener was attached in code. Nothing about the element says so.
//
// But attaching that listener is itself observable. This wraps
// addEventListener before the application runs and tags the element, which
// turns an invisible handler into something a selector can match.
//
// Runs in the page's world, because that is where the application's own calls
// happen; the tag is an attribute so the hint code, which runs in the
// extension's world, can still see it.
(function () {
	const ATTR = 'data-kbm-click';
	const INTERESTING = new Set(['click', 'mousedown', 'mouseup', 'pointerdown']);

	const proto = EventTarget && EventTarget.prototype;
	if (!proto || !proto.addEventListener || proto.__kbmProbed) return;

	const original = proto.addEventListener;

	proto.addEventListener = function (type, listener, options) {
		try {
			// Elements only. A listener on document or window is delegation, and
			// tagging those would hint the whole page as one target.
			if (INTERESTING.has(type) && this instanceof Element &&
				!this.hasAttribute(ATTR)) {
				this.setAttribute(ATTR, '');
			}
		} catch (e) { /* never let the tag break the page's own wiring */ }
		return original.call(this, type, listener, options);
	};

	try {
		Object.defineProperty(proto, '__kbmProbed', { value: true, enumerable: false });
	} catch (e) { /* sealed prototype: the wrapper is still in place */ }

	// Wrapping addEventListener is not enough on its own. GWT does not attach a
	// listener per element: it marks each widget with a __listener expando and
	// dispatches centrally, so a table row is never passed to addEventListener at
	// all. Those expandos are ordinary JavaScript properties, invisible from the
	// extension's world, so the sweep has to happen here.
	//
	// Driven by an event rather than a timer or an observer: the hint code asks
	// for it immediately before collecting, which costs one pass over the
	// document only when hints are actually opened.
	const MARKERS = ['__listener', '__eventBits', '__gwt_resolve'];

	function sweep() {
		let tagged = 0;
		for (const el of document.querySelectorAll('*')) {
			if (el.hasAttribute(ATTR)) continue;
			let marked = typeof el.onclick === 'function';
			if (!marked) {
				for (const key of MARKERS) {
					if (el[key] != null) { marked = true; break; }
				}
			}
			if (marked) { el.setAttribute(ATTR, ''); tagged++; }
		}
		return tagged;
	}

	document.addEventListener('kbm-tag-clickables', () => {
		try { sweep(); } catch (e) { /* a page that breaks the sweep still gets hints */ }
	});
})();
