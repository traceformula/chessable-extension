# Chess Utility Extension

A Chrome extension with two unrelated conveniences:

- **Keyboard move input for chess.com** — play by typing algebraic notation
  instead of dragging pieces.
- **Find position in course** — on a Chessable explore page, jump to the
  current position inside the course.

## Playing by keyboard

Type a move on any chess.com board. A move plays as soon as what you have
typed can no longer become any other legal move, so `e4` takes two keystrokes
and needs no Enter. Anything you type after that which still spells the move
you just played is absorbed, so typing `Nf3` in full does not leak a stray `3`
into the next move.

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

### Settings

Set these in the console on a chess.com page; they persist per browser.

```js
localStorage.setItem('kbm.commit', 'enter')   // require Enter for every move
localStorage.setItem('kbm.hud.scale', '2')    // keep the overlay up twice as long
```

Remove either key to go back to the default.

## Installing

Unpacked, for development or a single machine:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → choose this directory

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
