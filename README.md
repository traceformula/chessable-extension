# Chess Utility

A Chrome extension for playing chess and moving around the web without a mouse.

- **Type moves instead of dragging them** — on chess.com boards, Chessable
  explore boards, lichess analysis boards, and the clubxiangqi client.
- **Work any page from the keyboard** — label everything clickable and pick one,
  scroll, and click whatever find-in-page just landed on. On the chess sites by
  default, and on any other site you add.
- **Find position in course** — on a Chessable explore page, jump to the current
  position inside the course.

Nothing leaves the browser, and the only permission requested at install is
storage. Sites beyond the chess ones are granted one at a time, by you.

## Playing by keyboard

Type a move on a chess.com board, a Chessable explore board, or a lichess
analysis board; the xiangqi client takes squares instead, described below. A
move plays as soon as what you have typed can no longer become any other legal
move, so `e4` takes two keystrokes and needs no Enter. Anything you type after that which still spells the move
you just played is absorbed, so a trailing `+` or `=Q` does not leak into the
next move.

Auto-play waits for a whole destination square, and waits again if any other
legal move could still grow out of what you have typed. Without the first
rule, typing `bd6` when no bishop can reach d6 would play `Bd2` on the way -
the wrong move, which is worse than being told the move is illegal. Without
the second, `ooo` would castle short as it passed through `oo`.

Input is forgiving:

| You type | Means |
| --- | --- |
| `e4`, `nf3`, `NF3` | case is irrelevant |
| `nxd4`, `nd4` | the `x` is optional |
| `oo`, `0-0`, `O-O` | castle short (`ooo` for long) |
| `e2e4` | UCI also works |
| `e8` | promotes to a queen; `e8n` for a knight |
| `Rgxg6`, `R8xg6`, `Rg8xg6` | any disambiguator that identifies the origin |
| `Rxg6` | ambiguous — both candidates are shown, nothing is played |

### Where it works

| Site | Moves | Notes |
| --- | --- | --- |
| chess.com | notation | games, puzzles, analysis; premoves available |
| Chessable | notation | explore boards |
| lichess | notation | analysis and study boards only — see below |
| clubxiangqi | two squares | xiangqi; lobby and table shortcuts too |

On a lichess **game** page the board reports itself unplayable rather than
dropping moves silently: lichess exposes no controller there, and its own
keyboard-move box does not respond to anything synthetic.

### Keys

| Key | Does |
| --- | --- |
| `←` `→` | step back / forward one move |
| `↑` `↓` (`Home` `End`) | jump to start / end of the line |
| `u` | take back a move |
| `?` | show the keys, and whether premoves are on |
| `Esc` | clear what you have typed, or dismiss the overlay |

Typing is ignored when it is not your turn, when the focus is in a text field
so chat still works, and on boards you are only observing — those accept a
move locally without ever submitting it, which looks like a played move whose
clock keeps running.

### Xiangqi (clubxiangqi.com)

Moves are typed as two squares — file, rank, file, rank, so `5E5A` — rather
than as notation. `?` shows the same reminder on the board.

That is a deliberate limit, not an oversight. The CXQ client is a GWT
application with no usable JavaScript API, so the adapter reads the board from
the DOM and plays by clicking squares. Resolving piece-relative notation such
as `C2.5` would mean writing a xiangqi move generator — horse-leg and
elephant-eye blocking, cannon screens, palace, river, flying general — and
naming both squares needs none of it. Legality is left to the server, exactly
as it is for a mouse move.

The board geometry is read from the page's own file and rank labels at
runtime, so a board drawn from the other side resolves without a special case.

Arrows step through the moves by driving the client's own `<<` `<` `>` `>>`
controls, matched on the labels drawn on them — a GWT build leaves no id or
stable class to match instead. Takeback and premoves are not available there.

The lobby controls have shortcuts too, which fire only when no move is
half-typed — a move always starts with a file digit, so a letter on its own
cannot be part of one:

| Key | Control |
| --- | --- |
| `f` | FINDTABLE |
| `r` | rooms |
| `n` | new tables |
| `t` | tables |
| `j` | Join! |
| `o` | Options |
| `m` | type in chat |
| `Esc` | from chat, back to the board |
| `q` | resign |
| `=` | offer a draw |
| `u` | unsit |
| `x` | reset the board |

The last four change or end the game, so none is ever one keystroke away: the
key arms the action, `Enter` performs it, and any other key cancels.

These are matched on the visible label, so if the client renames a control its
shortcut reports `not found` rather than clicking something else.

### Site differences

Chessable's board is an iframe, so keystrokes only reach it once it has focus.
The outer page forwards them in, which means typing works without clicking the
board first.

Moves there go through the board's own drop handler rather than straight to
the position, so the move list, the FEN box and the opening explorer all
update the way they would after a drag. Taking back with `u` is chess.com
only: Chessable has no app-level retract to call, and rolling the position
back by hand would leave its move list showing a move that is no longer there.
Step back with the arrows instead.

### Premoves

Off by default; switch them on in the popup — click the extension's toolbar
icon. Pressing `?` on the board says which way they are currently set. With them on, typing during the
opponent's turn builds a premove instead of being ignored, and **Enter** queues
it — a premove never fires on its own, because it plays the instant the
opponent replies and cannot be taken back. `Esc` cancels one already queued.

Premove candidates come from chess.com rather than from our own move
generation, since the position a premove applies to does not exist yet: a
recapture is illegal until the opponent has played the capture. The list is
checked against the colour you are seated as before it is used, and premoves
are simply unavailable if it does not match.

chess.com executes the queued move itself, so there is no added delay.
Chessable explore boards have no opponent and no premoves.

### Clicking without the mouse

`;` labels everything clickable on screen; type a label to click it. `Esc`
cancels, `Backspace` corrects. Text fields are focused rather than clicked. If
nothing on the page can be clicked, it says so rather than doing nothing.

Clickability is judged three ways, because some applications give nothing away
in their markup. Declared markup — a link, a button, an ARIA role — is trusted
first. Then a pointer cursor. Then the handler itself: `clickable-probe.js`
runs in the page before the application does, wraps `addEventListener` to tag
whatever registers a click, and sweeps for the expandos frameworks leave on
their widgets when they dispatch centrally instead. GWT does exactly that, so
the xiangqi table rows are clickable without a role, an href, a tabindex or
even a pointer cursor.

Since a pointer cursor is inherited, a declared element always wins over the
box drawn around it, so a link never fragments into separate hints for its icon
and its text. Anything the size of the page is skipped: a handler that big is
delegation, not a target.

It is `;` and not Vimium's `f` because `f` is a file letter — binding it would
break `f4` and `Nf3` outright.

This exists so that Vimium can be switched off on these sites without losing
anything. It only runs where the extension already runs, so it needs no
permission beyond what the boards already required.

Same-origin frames are hinted together with the page holding them, so on
Chessable one press covers both the site navigation and the board's own
controls. Cross-origin frames cannot be reached and are skipped.

### Finding and clicking text

Press `/`, type what you can see, press Enter. The match is clicked.

| Key | Does |
| --- | --- |
| `/` | open the find bar |
| `↑` `↓` (or Tab) | move between matches |
| `Enter` | click the current match |
| `Esc` | cancel |

This is a search of our own rather than the browser's, for a specific reason.
Chrome's find highlight is not in the page, and the match only becomes a
selection when the text is selectable — which buttons, menus and navigation
almost never are, since they set `user-select: none`. A `Range` is unaffected by
that, so measuring a match works on exactly the controls the browser's find
cannot hand over.

The click goes to a **point** rather than to an element: whatever
`elementFromPoint` returns at the middle of the match is what a mouse would have
hit, including anything layered on top. Matches inside same-origin frames are
found too.

`'` still clicks whatever Chrome's own find left selected, which works on prose
and not on controls. `/` is the one to reach for.

### Scrolling

| Key | Does |
| --- | --- |
| `w` `s` | scroll up and down |
| `W` `S` | jump to the top or bottom |

Not vim's `j`/`k`: on a chess board `k` is the king (`Kf1`, `Kxd4`), and on the
xiangqi client `j` is a rank letter, so neither half of that pair is free. `w`
and `s` are unused by every notation here.

Whatever the focus sits inside is scrolled in preference to the page, and if
the document itself does not scroll the largest scrolling panel on screen is
used — board pages are often a fixed shell around one scrolling column, where
scrolling the document does nothing at all.

### Adding other sites

Link hints and scrolling can run anywhere, not just the chess sites. Open the
extension's options page — the **Manage sites…** button in the popup — type a
domain, and Chrome asks you to confirm that one origin. Nothing else changes.

Adding a site from the options page rather than the popup is deliberate:
Chrome's permission prompt can close a popup, and that cancels the request the
popup was opened to make. It fails silently, so the site looks enabled while
nothing was granted.

This is why the extension requests no broad access at install. Sites are host
permissions you grant yourself, one at a time, and any of them can be taken
back from `chrome://extensions` without affecting the others. Removing one from
the popup revokes the permission outright rather than merely disabling it.

Only page navigation extends this way. The board adapters read one site's
internals each and have nothing to offer an arbitrary page.

### Settings

Click the extension's toolbar icon. Two settings, both stored in
`chrome.storage.sync` so they follow your Chrome profile to other machines:

- **Commit a move** — automatically as soon as the input is unambiguous, or
  only on Enter. Enter is worth trying if auto-play catches you out; a typo
  that happens to be legal is played immediately otherwise.
- **Overlay duration** — how long messages stay on the board.
- **Premoves** — see above. Off by default.

A move is never played on a single keystroke, even when one letter already
resolves uniquely, since that is indistinguishable from a stray keypress.

Changing a setting applies to chess.com tabs opened afterwards; reload an
open tab to pick it up.

## Installing

Unpacked, for development or a single machine:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → choose this directory

The only permission requested is `storage`, for the settings above. No data
leaves the browser.

After changing any file you must reload the extension *and* refresh the page:
reloading alone re-registers the extension, but tabs keep the content scripts
they were loaded with. `__KBM.version` in the console reports what the page is
actually running, which is the number that matters.

## Development

```sh
npm test           # resolution logic and the vendored engine
npm run package    # build dist/chess-utility-extension-<version>.zip
```

`scripts/keyboard-move/vendor/chess.js` is chess.js 1.4.0, vendored verbatim
under BSD-2-Clause and wrapped to load as a classic script. Legal moves are
generated from the board FEN rather than read from chess.com's own move list,
which returns the wrong colour's moves on some pages.
