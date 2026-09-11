# Chess Utility Extension

A Chrome extension with two conveniences:

- **Keyboard move input** — play by typing algebraic notation instead of
  dragging pieces, on chess.com boards and Chessable explore boards.
- **Find position in course** — on a Chessable explore page, jump to the
  current position inside the course.

## Playing by keyboard

Type a move on any chess.com board or Chessable explore board. A move plays as soon as what you have
typed can no longer become any other legal move, so `e4` takes two keystrokes
and needs no Enter. Anything you type after that which still spells the move
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

### Keys

| Key | Does |
| --- | --- |
| `←` `→` | step back / forward one move |
| `↑` `↓` (`Home` `End`) | jump to start / end of the line |
| `u` | take back a move |
| `?` | show the key list |
| `Esc` | clear what you have typed, or dismiss the overlay |

Typing is ignored when it is not your turn, when the focus is in a text field
so chat still works, and on boards you are only observing — those accept a
move locally without ever submitting it, which looks like a played move whose
clock keeps running.

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

### Settings

Click the extension's toolbar icon. Two settings, both stored in
`chrome.storage.sync` so they follow your Chrome profile to other machines:

- **Commit a move** — automatically as soon as the input is unambiguous, or
  only on Enter. Enter is worth trying if auto-play catches you out; a typo
  that happens to be legal is played immediately otherwise.
- **Overlay duration** — how long messages stay on the board.

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
