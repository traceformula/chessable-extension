// Chessable's board is in an iframe, and keystrokes only reach it once it has
// focus - so on a freshly loaded page, typing would do nothing until you clicked
// the board. This runs in the outer page and forwards keys inward.
//
// Nothing is interpreted here: the frame with the board decides what is a move
// and what is not.
(function () {
	const BOARD_FRAME = 'iframe.mt1iframe';
	const FORWARD = /^([a-hA-HNBRQKnbrqk1-8oO0xX=?-]|Escape|Enter|Backspace|Arrow(Left|Right|Up|Down)|Home|End|u)$/;

	function editable(node) {
		if (!node) return false;
		const tag = node.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
			node.isContentEditable === true;
	}

	const nativeAdd = EventTarget.prototype.addEventListener;
	nativeAdd.call(window, 'keydown', e => {
		if (e.__kbmRelayed) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (editable(e.target)) return;
		if (!FORWARD.test(e.key)) return;

		const frame = document.querySelector(BOARD_FRAME);
		if (!frame) return;
		// Already focused: the keystroke is being delivered there anyway, and
		// forwarding as well would play the move twice.
		if (document.activeElement === frame) return;

		const doc = (function () { try { return frame.contentDocument; } catch (err) { return null; } })();
		if (!doc) return;

		e.preventDefault();
		const copy = new KeyboardEvent('keydown', {
			key: e.key, code: e.code, bubbles: true, cancelable: true,
			shiftKey: e.shiftKey,
		});
		copy.__kbmRelayed = true;
		doc.dispatchEvent(copy);
	}, true);
})();
