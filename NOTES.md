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

## lichess: both board types work

The adapter exists as of v1.16.0; game pages joined it in v1.27.0. The two
board types share almost nothing, so the adapter picks a mode and routes.

**Analysis and study boards.** `site.analysis` exposes the controller:
`userMove(orig, dest)` plays, `chessground.getFen()` gives placement (not a
full FEN), `chessground.state.movable.dests` gives legal destinations without
SAN, and the full FEN is in the `.copyables .fen input` field. Moves are
generated locally from the FEN and then filtered against those dests, which is
lichess's legality rather than ours - that covers castling rights being deduced
wrongly when no full FEN is published. Verified against a live board: 33
generated, 33 surviving the filter, `O-O` kept even though lichess encodes
castling as `e1->h1` as well as `e1->g1`.

**Game pages expose nothing at all.** No `site.round`, no `site.socket`, no
expando on `cg-board` or `.round__app`, nothing left attached by snabbdom -
re-confirmed on a live round page. Synthetic mouse and pointer events are
refused by chessground, and so is its own keyboard-move box; four ways of
driving that box were tried and none moved a piece. The likeliest explanation
is an `isTrusted` check, never confirmed.

So the DOM was the wrong place to look. The page has to tell the *server* about
the move, and it does that over a WebSocket. Wrapping the constructor in a Proxy
at `document_start` - before lichess opens it - hands us the very socket the
page uses, and the move is the frame lichess itself sends:

    {"t":"move","d":{"u":"e2e4"}}

The server replies to the socket rather than to whoever called it, so the move
arrives back down the wire and lichess's own code puts it on the board. Nothing
is faked and nothing is driven through the UI. This is the same path a move from
another device takes.

Read out of the deployed round bundle: `sendMove` -> `actualSendMove`, payload
`{u: orig + dest}`, message types `move` and `drop`, sent with `ackable`. We
omit the ack id: it only drives lichess's own resend timer, and a move that goes
missing is reported as not accepted rather than silently retried.

Only a `/play/` socket is a game we are sitting at - spectating opens
`/watch/<id>/<colour>/v6` - so a board we are merely watching can never be moved
on. Verified with a Proxy over a dead localhost port: `/play/` captured,
`/watch/` ignored, and `instanceof`, the static constants, `.prototype`,
`.name` and `.url` all still intact through the wrapper.

Position has to come off the DOM, since no controller will tell us:

- **Placement** from the rendered `<piece>` elements. Chessground lays them out
  on an eighth-of-the-board grid via `transform: translate(Xpx, Ypx)`, and
  `.cg-wrap` carries the orientation. Verified against `chessground.getFen()` on
  an analysis board, in both orientations, exact match. Pieces marked `.ghost`
  (being dragged) and `.fading` (just captured) are skipped so they cannot
  double up, and mid-animation offsets round to the square being travelled to.
- **Board size** is asked of `cg-board`, then `cg-container`, then `.cg-wrap`,
  taking the first non-zero answer. A flip rebuilds these, and a measurement
  taken during one reports zero - which would put every piece on one square.
- **Turn** from the running clock, then the `ply` on the last move frame (odd
  leaves black to play), then white if the board is untouched. The clock alone
  is not enough: correspondence games have none, and neither clock runs before
  the opening move.
- **Which side we are** from the `.ruser` box carrying our own username, paired
  with the `.rclock` on the same side. Read that way rather than from the
  orientation, which the player can flip.
- **Castling** is deduced from where kings and rooks stand, as on analysis
  boards, but with no dests to filter against. A wrong guess is safe here: the
  server ignores an illegal move, our verify step sees the board unchanged, and
  it is reported as not accepted rather than becoming some other move.
- **En passant** from the `uci` of the last move frame, when a pawn has just
  crossed two ranks. Unavailable until a move arrives, so joining mid-game
  misses one capture at most.

Every move is confirmed by watching the placement actually change, so a refused
move reports itself instead of appearing to have worked.

A finished game still looks playable from the outside - the socket stays open
for a while and the ply count still names a side to move - so the result in
the move list is checked first. Verified both ways: no marker at all on a live
round page, present on a finished game.

Post-game viewing is two different pages. Once a game is over, every public
URL shape for it (/id, /id/white, /id/black) serves the *analysis* app, which
works fully - typing a move there was driven end to end. The player URL you
are left on straight after your own game keeps the round app, where there is
no controller to play variations against; that now says so and points at the
analysis board.

**Still unverified:** the server accepting our frame. The protocol was read out
of lichess's own bundle rather than observed being sent, because observing it
means playing a real game on the user's account. Everything around it - the
capture, the transparency of the wrapper, the position reading in both
orientations - is verified.

## Match patterns

Chrome match patterns are host-exact: `https://www.site.com/*` does not match
`https://site.com/`. Every host is therefore listed in both forms. This cost a
round of "hints are broken" reports that were really "nothing was injected
here at all" — the symptom is indistinguishable, so check `__KBM` in the
console before debugging any behaviour.

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
