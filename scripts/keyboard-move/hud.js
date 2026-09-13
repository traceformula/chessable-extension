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
.kbm-note { opacity: .7; font-size: 13px; max-width: 60ch; white-space: normal; }
.kbm-hud[data-open="1"][data-mode="help"] {
	display: block; padding: 16px 19px 17px; border-radius: 11px;
	max-width: min(94vw, 540px); line-height: 1.45;
	/* Opaque, unlike the transient overlay: this one is read, and page content
	   showing through a reference panel makes it hard work. */
	background: #121214;
	border: 1px solid rgba(255,255,255,.08);
	box-shadow: 0 10px 34px rgba(0,0,0,.5);
	/* Monospace suits a move buffer, not prose. Keys keep it; the rest does not. */
	font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.kbm-help-group {
	font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em;
	opacity: .58; font-weight: 600; margin: 14px 0 6px;
}
.kbm-help-group:first-child { margin-top: 0; }
.kbm-help-row { display: flex; gap: 12px; align-items: baseline; padding: 2.5px 0; }
.kbm-help-keys { flex: 0 0 124px; display: flex; flex-wrap: wrap; gap: 4px; }
.kbm-help-keys span {
	padding: 1.5px 6px; border-radius: 4px; background: rgba(255,255,255,.13);
	font: 11.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap;
}
.kbm-help-desc { flex: 1; font-size: 13px; opacity: .9; white-space: normal; }
.kbm-help-foot {
	margin-top: 14px; padding-top: 11px; font-size: 12px; opacity: .55;
	white-space: normal; border-top: 1px solid rgba(255,255,255,.09);
}
`;

	let el, bufEl, candsEl, noteEl, helpEl;

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
		helpEl = document.createElement('div');
		helpEl.className = 'kbm-help';
		el.append(bufEl, candsEl, noteEl, helpEl);
		document.body.appendChild(el);
	}

	ns.hud = {
		show(buffer, result, note) {
			build();
			if (helpEl) helpEl.textContent = '';
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
		// Help is a reference panel rather than the single row the overlay uses for
		// everything else: grouped, with the keys in a column of their own so they
		// can be scanned without reading the descriptions.
		//
		// Takes [{ group, rows: [[keys, description], ...] }, ...], where keys is
		// a string or an array of them. A trailing string becomes a footnote.
		help(sections) {
			build();
			helpEl.textContent = '';
			for (const section of sections) {
				if (typeof section === 'string') {
					const foot = document.createElement('div');
					foot.className = 'kbm-help-foot';
					foot.textContent = section;
					helpEl.appendChild(foot);
					continue;
				}
				if (section.group) {
					const head = document.createElement('div');
					head.className = 'kbm-help-group';
					head.textContent = section.group;
					helpEl.appendChild(head);
				}
				for (const [keys, desc] of section.rows) {
					const row = document.createElement('div');
					row.className = 'kbm-help-row';
					const keyCell = document.createElement('div');
					keyCell.className = 'kbm-help-keys';
					for (const key of [].concat(keys)) {
						const chip = document.createElement('span');
						chip.textContent = key;
						keyCell.appendChild(chip);
					}
					const descCell = document.createElement('div');
					descCell.className = 'kbm-help-desc';
					descCell.textContent = desc;
					row.append(keyCell, descCell);
					helpEl.appendChild(row);
				}
			}
			el.dataset.open = '1';
			el.dataset.state = 'empty';
			el.dataset.mode = 'help';
			bufEl.textContent = '';
			candsEl.textContent = '';
			noteEl.textContent = '';
		},
		hide() {
			if (!el) return;
			el.dataset.open = '0';
			// Clear the mode too. The help rules set their own display, and leaving
			// the attribute set kept the panel painted after it had been closed.
			delete el.dataset.mode;
		},
		isOpen() {
			return !!el && el.dataset.open === '1';
		},
	};
})();
