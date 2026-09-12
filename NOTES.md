# Notes for future work

State as of 2026-09-11. Keyboard move input works on chess.com and Chessable
explore boards; premoves ship off by default. What follows is what was left
undone and what is worth knowing before touching it.

## Verify before building further

Two premove behaviours were shipped assumed rather than confirmed, because the
only test board available was a vs-computer game whose seat state had been
corrupted by playing moves for both colours.

- **`game.premoves.getLegalMoves()` colour.** Every sample came back `color: 2`
  regardless of whose turn it was. The assumption is that it returns the side
  *not* to move. `chesscom.premoveMoves()` guards this by returning `[]` when the
  list does not match the seat, so a wrong assumption shows up as **premoves
  silently doing nothing**, not as wrong moves being offered. If that is the
  symptom, the semantics are inverted from what was assumed.
- **`game.premoves.move(from, to)`.** Arity is 2; the argument order is a guess,
  and a queued premove was never observed actually firing.

Both need one clean game against a real opponent.

## lichess: analysis works, games do not

The adapter exists as of v1.16.0. Analysis and study boards are fully working.
Game pages are not, and it is not obvious that they can be.

Moves are generated locally from the FEN and then filtered against
chessground's own `state.movable.dests`, which is lichess's legality rather
than ours - that covers castling rights being deduced wrongly when no full FEN
is published. Verified against a live board: 33 generated, 33 surviving the
filter, `O-O` kept even though lichess encodes castling as `e1->h1` as well as
`e1->g1`.

**The game-page transport is unsolved.** Four ways of driving lichess's own
keyboard-move box were tried on an analysis board and none moved a piece:
setting `value` then Enter as keydown, as keypress, as keyup, and typing
character by character with a full event set per character. Synthetic mouse
events on chessground are refused the same way. The likeliest explanation is an
`isTrusted` check - chessground definitely does this for drags - but it could
not be confirmed, because redefining `Event.prototype.isTrusted` from the
console had no effect either.

Worth trying next, in order: the `isTrusted` override from a real MAIN-world
content script at `document_start`, where it persists and may behave
differently from a console context; then `chrome.debugger`, which produces
genuinely trusted events at the cost of a permanent "Chrome is being debugged"
banner.

What the original de-risk established:

- **Analysis boards are solved.** `site.analysis` exposes the controller:
  `userMove(orig, dest)` plays, `chessground.getFen()` gives placement (not a
  full FEN), `chessground.state.movable.dests` gives legal destinations without
  SAN, and the full FEN is in the `.copyables .fen input` field.
- **Game pages expose nothing.** `site.round` does not exist; there are no
  expando properties on `cg-board` or `.round__app` leading to the controller,
  and snabbdom leaves nothing attached.
- **Synthetic events do not work.** Neither MouseEvent nor PointerEvent
  sequences moved a piece, though `cg.getKeyAtDomPos()` confirmed the square
  geometry was being computed correctly. An `Event.prototype.isTrusted` override
  was attempted but did not persist between tool calls, so it is untested rather
  than disproven — worth retrying from a content script at `document_start`,
  where it would persist.

Three candidate transports for game pages, in the order worth trying:

1. **Drive lichess's own keyboard input.** It has a native move-input box
   (Preferences → Game behaviour → "Input moves with the keyboard"). Capture keys
   ourselves, write the resolved move into `.keyboard-move input`. Most likely to
   just work; their box becomes the transport.
2. **Test the `isTrusted` override properly**, from a `document_start` content
   script. If it holds, synthetic events work and both sites share one path.
3. **`chrome.debugger`** for genuinely trusted events. Certain to work, but shows
   a persistent "Chrome is being debugged" banner. Last resort.

Note lichess's native input will fight ours if left enabled: `Enter` steals
focus into their box. Detect `.keyboard-move` and either stand down or tell the
user to turn their preference off.

## Smaller items

- **Promotion on Chessable.** `onDrop`'s signature has nowhere to pass the
  promotion piece, so it likely always queens. Untested.
- **Command mode.** `:resign`, `:draw`, `:flip`, `:rematch` were in the original
  sketch and never built.
- **Publishing.** `npm run package` produces the upload zip and the icons are in
  place. Still needed for the Web Store: screenshots (1280x800 or 640x400), a
  store description, and a decision on whether the Chessable "Find Position in
  Course" button belongs in a published build.
- **`find_position_in_course.js`** builds a URL from the page's FEN field without
  `encodeURIComponent`. It cannot leave chessable.com, but a `#` or `?` in that
  field would malform the URL. Predates this work.

## What chess.com lies about

Each of these cost a debugging round because our own code was suspected first.
The rule that emerged: cross-check anything chess.com reports against the FEN or
the seat, and prefer computing locally.

| Call | What it does |
| --- | --- |
| `getLegalMoves()` | Returned 106 moves all `color: 2` on a white-to-move board (/play/computer). Legal moves are now generated locally from `getFEN()`. |
| `getLegalMovesForSquare()` | Returned `[]`, or entries with null SANs, on that same board. |
| `usePlayingAs()` | Returns `undefined` on boards that are certainly seated. The real flag is `getMode().usePlayingAs`. |
| `getPlayingAs()` | Intermittently `undefined`. Board orientation is the fallback. |
| `move()` | Applies on the **next tick**, so a same-tick `getFEN()` read sees the old position. Never verify in the same block; never let a verify drive a retry. |
| mode `observing` | Accepts `move()`, mutates the model and animates the board while submitting nothing. The move looks played and the clock keeps running. |

`isLegalMove()` and `move()` themselves were reliable throughout — it is the
*reporting* that is not.

## The bug class to watch for

Three separate incidents had the same shape: typed input played a **different
legal move** than intended.

- `bd6` played `Bd2` — committed on a half-typed destination square.
- `ooo` castled short — committed as it passed through `oo`.
- `bb` played `b5` — `canon()` lowercases, so the b-file pawn move looked like a
  bishop move and was given the spelling `bb5`.

The guards now are: a whole destination square must be typed, no other legal
move may still extend the input, and never on a single keystroke. The b-file is
the place to look for more of these, being the one letter that is both a piece
and a file.
