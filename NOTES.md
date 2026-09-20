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

## Chat transcripts: deliberately a separate subsystem

Added v1.28.0 for claude.ai, chatgpt.com and chat.openai.com. Kept apart from
the chess code on purpose: its own directory, its own `__CHATNAV` namespace, its
own manifest entry, its own tests, and no shared imports in either direction.
These sites reshuffle their markup far more often than the chess ones, and that
churn must not be able to reach a board.

The interface lives in a shadow root. Both sites ship very assertive global CSS,
and a shadow root is the only way to be sure neither side bleeds into the other.
The one thing written into the page is a stylesheet for the fold, which has to
apply to the site's own elements.

**Selectors, measured 2026-09-20 on live pages:**

- claude.ai: `[data-testid="user-message"]`, `[data-testid="assistant-message"]`.
  Clean and semantic.
- chatgpt.com: `[data-message-author-role="user"|"assistant"]`.

Note what is *not* there: `article[data-testid^="conversation-turn"]`, the
ChatGPT selector every write-up still quotes, now matches nothing. It is kept at
the end of the chain as a fallback and as a reminder that this is how the
feature breaks. An empty chain is reported out loud; `:help` names the selector
currently matching, so a stale one is a one-line fix in `sites.js`.

**claude.ai virtualizes its transcript.** An earlier note here said it did not,
on the evidence of an 11,720px conversation whose counts never changed. That
conversation was simply short enough to fit; the claim did not survive a longer
one. A 38-turn chat had *2* user messages in the page and a `transcript-spacer`
div 26,988px tall standing in for everything else, which is exactly why `:ls`
reported "2 turns".

The structure is `[data-testid="transcript-row"]`, each carrying `data-index`
and `data-perf-row-from-tail`. Those two sum to a constant, so the length of the
whole transcript is `index + fromTail + 1` from any single rendered row - 76,
confirmed against the API.

So the outline is read from the endpoint the page itself loads:

    /api/organizations/<org>/chat_conversations/<id>?tree=True&rendering_mode=messages

Same origin, the user's own session, nothing leaves the page. 76 messages, 38
human, and each message's `index` matches the DOM's `data-index` exactly -
verified row by row against the five that happened to be rendered, senders and
all. That correspondence is what makes jumping to an unrendered turn possible.
The words are in `content[]` blocks of type `text`; the `text` field is empty on
current conversations, and `thinking` blocks are skipped.

Falling back to the DOM stays correct when the fetch fails, and the panel then
says "N of M rows loaded" rather than presenting a count it cannot stand behind.

**ChatGPT virtualizes too, and worse for our purposes.** Same symptom - `:ls`
found 2 turns - but a different mechanism and no way to count around it.
Unrendered turns are empty divs whose class reserves their height,
`div[class*="last-known-height"]`, and only the ones adjacent to the mounted
window exist at all. A conversation with 64 user turns on its live branch had
about ten mounted rows and five placeholders, so `rendered + placeholders` is
not the total and nothing in the DOM is.

The page's own data is behind `/backend-api/conversation/<id>`, which returns
404 on cookies alone; it wants `Authorization: Bearer <accessToken>`, and the
token comes from `/api/auth/session`. That works, but it means handling the
user's access token, which claude.ai never required - cookies carried that one.
Not shipped without asking.

Note also that the payload is a tree, not a list. The 165 mapping nodes include
every edit and regeneration; the conversation as displayed is the path from
`current_node` back through `parent`, which came to 64 user and 92 assistant
messages. Counting mapping nodes would overcount by every branch the user ever
abandoned. User text is in `message.content.parts`, an array of strings.

Until that decision is made, ChatGPT reports what it can stand behind: the turns
that are loaded, and plainly that the rest is not, with no invented total.

**A warning about measuring any of this from automation.** The tab driving these
experiments reported `visibilityState: "hidden"` and `requestAnimationFrame`
never fired, so nothing repainted. Under those conditions the virtualizer cannot
render new rows however it is scrolled, and two conclusions drawn here before
that was noticed - that scanning by scrolling wedges the renderer, and that the
virtualizer ignores programmatic scrolling - are artifacts of the hidden tab
rather than findings about the site. The seek in `main.js` is therefore
UNVERIFIED. Reading the transcript from the API is still the better design, for
being instant and complete rather than repainting the conversation to count it,
but it was not chosen on the evidence those two experiments appeared to give.

**claude.ai does not scroll the document.** `document.scrollingElement` reports
754px; the transcript is an inner `overflow-y-auto` container. Nothing here
scrolls by hand - `scrollIntoView` finds the right container by itself, verified
moving 11015 -> 10081 inside it.

Rehearsed against the live page before shipping, since the extension cannot be
reloaded from a tool: the shadow bar renders full width and hit-tests topmost,
the fold takes a reply from 752px to 63px, `scrollIntoView` moves the inner
scroller, and the composer is `contenteditable` so the `:` guard catches it. The
glue in `main.js` still wants one real pass by hand, and the signed-out ChatGPT
page is untested - the browser here is signed in to both.

The `:mute` noise lists are near-empty on purpose. Guessing selectors for
promotional elements risks hiding real UI, so it hides only what it can name and
says "nothing matched" otherwise, rather than pretending to have worked.

## Escape as the way back to the shortcuts

Added v1.29.0, in both subsystems separately - `scripts/keyboard-move/blur.js`
for the page layer and a few lines inside chat-nav's key handler. Duplicated on
purpose rather than shared, to keep the two apart.

Standing down inside a text box is correct, but it left no way back except the
mouse. Escape is the way back.

Two choices worth keeping:

- **The key is not consumed.** Many pages bind Escape to close their own dialog
  or cancel their own edit. Taking focus away is all this needs.
- **The blur is deferred one tick.** The page gets its own Escape first, with
  focus still where it expects it, and an editor that answers Escape by
  refocusing itself loses to us rather than the other way round. The deferred
  callback re-checks that focus has not already moved on its own.

Measured before shipping, since the extension cannot be reloaded from a tool:

- claude.ai composer is a `contenteditable` div; `blur()` sticks, focus lands on
  `BODY` and stays there.
- onecompiler.com runs Monaco, which focuses a real `textarea.inputarea`. A full
  rehearsal - focus, dispatch Escape, deferred blur - left focus on `BODY` and
  it stayed there. Monaco does not fight back.

A site that is not built in needs adding through the options page first; the
release ships with the rest of the page layer, so `blur.js` had to go into
`PAGE_JS` in the service worker as well as into the manifest entry. Missing one
of the two is the obvious way to half-ship this.

## Shadow roots hide the text box from every guard

Found v1.29.1, from a report that ":collapse" could only be typed as ":collape"
on claude.ai.

Every key guard in the extension stands down when the key was typed into a text
box, and every one of them asked the same two questions: `e.target` and
`document.activeElement`. Both of them stop at a shadow boundary.

An event raised inside a shadow root is retargeted to the host on its way out,
and `document.activeElement` reports the host too. Measured on claude.ai with a
focused `<input>` inside an open shadow root:

    e.target               DIV    (NOT editable)   <- what the guard saw
    document.activeElement DIV
    composedPath()[0]      INPUT  (editable)       <- the truth

So the chat command line, which lives in a shadow root precisely to keep these
sites' CSS out, looked like a plain `<div>` to `scroll.js` - and the page layer
was registered on claude.ai, so the "s" in "collapse" scrolled the page instead
of reaching the input. Every other letter in the word is unbound, which is why
exactly one character went missing.

The fix is `composedPath()[0]` for the target and a walk down `shadowRoot
.activeElement` for the focus, applied in every guard: `scroll.js`, `hints.js`,
`blur.js`, the chess `main.js` and chat-nav's own handler. Duplicated per file
rather than shared, as `editable()` already is.

This was never only about our own command line. Any page built out of web
components puts its text boxes inside shadow roots, and on all of them the
typing guard was failing open. Closed roots stay invisible by design -
`composedPath()` stops at the host - and nothing can be done about those.

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
