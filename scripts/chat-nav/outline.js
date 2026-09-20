// Turning a turn into one line of outline.
//
// The summary is built from what you asked, not from what the model answered:
// your own prompts are the index you actually navigate by, and building it this
// way means nothing has to leave the page to produce it.
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	root.__CHATNAV = root.__CHATNAV || {};
	root.__CHATNAV.outline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

	const MAX = 90;

	// The first line that carries anything, not the first MAX characters of the
	// whole prompt: a prompt often opens with a sentence and then pastes a wall
	// of code, and the sentence is the part worth showing. Fenced code and
	// quoted lines are skipped for the same reason.
	function label(text, max) {
		const limit = max || MAX;
		const lines = String(text == null ? '' : text).split('\n');

		let fenced = false;
		let pick = '';
		for (const raw of lines) {
			const line = raw.trim();
			if (/^```/.test(line)) { fenced = !fenced; continue; }
			if (fenced || !line) continue;
			if (/^[>|]/.test(line)) continue;
			pick = line;
			break;
		}
		// Nothing outside a fence: the prompt is all code. Take the first line of
		// it rather than the fence markers, which label nothing.
		if (!pick) {
			for (const raw of lines) {
				const line = raw.trim();
				if (!line || /^```/.test(line)) continue;
				pick = line;
				break;
			}
		}
		if (!pick) return '(empty)';

		pick = pick.replace(/\s+/g, ' ').replace(/^#+\s*/, '');
		return pick.length > limit ? pick.slice(0, limit - 1).trimEnd() + '…' : pick;
	}

	return { label, MAX };
});
