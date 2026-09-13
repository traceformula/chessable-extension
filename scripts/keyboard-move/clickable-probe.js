// Notes which elements have a click handler, so hints can find them.
//
// Some applications give nothing away in their markup. The xiangqi client is
// compiled from Java: its table rows are bare divs with no href, no role, no
// tabindex, and not even a pointer cursor. What they do carry is a __listener
// expando, because GWT dispatches centrally rather than binding per element.
// Those are ordinary JavaScript properties, invisible from the extension's
// world, so they have to be read from the page's own.
//
// Nothing is written to the DOM while the page runs. Attributes are materialised
// only when hints ask, and cleared again immediately - an earlier version tagged
// elements from inside addEventListener and broke YouTube, because web
// components call addEventListener in their constructor and setting an attribute
// there is forbidden.
//
// It no longer wraps addEventListener at all. Doing so put this file in the call
// stack of every listener any page registered, which meant Chrome attributed the
// page's own policy violations to the extension - YouTube Studio forbids unload
// listeners, registers one anyway, and the report named this script. The
// detection that hook added was marginal: anything with a real handler almost
// always also has a pointer cursor, a role, or an expando, and those are read
// below without touching a method every page depends on.
(function () {
	const ATTR = 'data-kbm-click';
	const MARKERS = ['__listener', '__eventBits', '__gwt_resolve'];

	if (document.__kbmProbed) return;
	try {
		Object.defineProperty(document, '__kbmProbed', { value: true, enumerable: false });
	} catch (e) { /* listeners below are still registered once per injection */ }

	function isClickable(el) {
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
