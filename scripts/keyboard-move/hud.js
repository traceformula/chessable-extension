// Small overlay showing what has been typed and, when the input is still
// ambiguous, which moves it could become.
(function () {
	const ns = (globalThis.__KBM = globalThis.__KBM || {});

	const CSS = `
.kbm-hud {
	position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
	z-index: 2147483000; pointer-events: none;
	display: none; align-items: center; gap: 10px;
	padding: 8px 14px; border-radius: 8px;
	background: rgba(20,20,20,.92); color: #f4f4f4;
	font: 500 15px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
	box-shadow: 0 4px 16px rgba(0,0,0,.4);
	transition: background-color .12s ease;
}
.kbm-hud[data-open="1"] { display: flex; }
.kbm-hud[data-state="none"] { background: rgba(150,40,40,.95); }
.kbm-buf { font-size: 17px; letter-spacing: .5px; }
.kbm-buf:after { content: "_"; opacity: .55; }
.kbm-cands { display: flex; gap: 7px; opacity: .78; font-size: 13px; }
.kbm-cands span { padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,.12); }
.kbm-note { opacity: .7; font-size: 13px; }
.kbm-hud[data-mode="help"] { flex-direction: column; align-items: flex-start; gap: 5px; max-width: min(92vw, 620px); }
.kbm-hud[data-mode="help"] .kbm-line { font-size: 12.5px; line-height: 1.5; white-space: normal; }
.kbm-hud[data-mode="help"] .kbm-line:first-child { opacity: 1; }
.kbm-hud[data-mode="help"] .kbm-line { opacity: .8; }
`;

	let el, bufEl, candsEl, noteEl;

	function build() {
		if (el) return;
		const style = document.createElement('style');
		style.textContent = CSS;
		document.head.appendChild(style);

		el = document.createElement('div');
		el.className = 'kbm-hud';
		bufEl = document.createElement('div');
		bufEl.className = 'kbm-buf';
		candsEl = document.createElement('div');
		candsEl.className = 'kbm-cands';
		noteEl = document.createElement('div');
		noteEl.className = 'kbm-note';
		el.append(bufEl, candsEl, noteEl);
		document.body.appendChild(el);
	}

	ns.hud = {
		show(buffer, result, note) {
			build();
			for (const row of [...el.querySelectorAll('.kbm-line')]) row.remove();
			delete el.dataset.mode;
			el.dataset.open = '1';
			el.dataset.state = result ? result.state : 'empty';
			bufEl.textContent = buffer;
			noteEl.textContent = note || '';
			candsEl.textContent = '';
			if (result && result.state === 'ambiguous') {
				for (const m of result.candidates.slice(0, 8)) {
					const s = document.createElement('span');
					s.textContent = m.san;
					candsEl.appendChild(s);
				}
			}
		},
		// Help is laid out as stacked lines rather than the single row the overlay
		// normally uses: it is the one thing here meant to be read rather than
		// glanced at.
		help(lines) {
			build();
			el.dataset.open = '1';
			el.dataset.state = 'empty';
			el.dataset.mode = 'help';
			bufEl.textContent = '';
			candsEl.textContent = '';
			noteEl.textContent = '';
			for (const text of lines) {
				const row = document.createElement('div');
				row.className = 'kbm-line';
				row.textContent = text;
				el.insertBefore(row, noteEl);
			}
		},
		hide() {
			if (el) el.dataset.open = '0';
		},
		isOpen() {
			return !!el && el.dataset.open === '1';
		},
	};
})();
