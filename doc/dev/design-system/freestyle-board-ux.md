# Freestyle board UX — the TALLY desk

> Design brief for the Freestyle **control** page (`web/src/app/pages/Freestyle/ControlPage.tsx`
> and its panels). Iteration 2, 2026-09-07. Synthesised from the three-concept design review
> (NEXT PRESS deck / Cue List + GO rail / TALLY) against a 28-finding audit that scored the
> current board **4.2 / 10**. The backlog that builds it is `status.md` §3 "Freestyle board UX"
> (specs in `plans.md`); the settled-constraint amendments are **ADR 0046** (accepted 2026-09-08).
> **This is the snapshot the build started from, not the queue.** Every table below keeps the
> backlog id it was minted with, landed or not — so an id read here is work only while §3 still
> carries its checkbox, and a row naming a closed one is already answered rather than owed.
> Companion: `design-system.md` (tokens, the race-state language) and `component-layer.md`.

**Iteration 2 — what changed and why** (critic review of iteration 1, all verified in code):

| #   | Blocker / suggestion                                                                                                                       | Resolution (where)                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `SET_BUDGETS` returns `effects: []` (`battleMachine.ts:511-520`) and re-arms every `idle` lane — a held lane is `idle` too (`stoppedLane`) | `SET_BUDGETS` emits one `reset_countdown` per lane it re-arms (peers `PEER_RESET`, preview mirrors — an existing message) and touches only **pristine** lanes; each lane carries `armedMs` (§4.6). Own slice `fsux-set-budgets`, before the page predicates |
| B2  | The §6 pairs failed the brief's own ≥4.5:1 guard (`stop`+white 3.6, `goDim`+white 4.1, `setDim` on canvas 3.7, Save teal+white 3.0)        | §6 names every pair with its computed ratio; new `*Text` tiers for text <24 px; `stopDim` for every stop fill; Save on `tealDark`; idle frame stroke `ink.mid`. `fsux-race-tokens` + `contrast.test.ts` move into Round 1                                   |
| B3  | Space bails on `[role=dialog]`, pad 10 and the plate have no guard — the three triggers diverge while a confirm is open                    | One `advanceBlocked()` for all three; ADVANCE while a confirm is open **is the confirm's safe action** and nothing else (§4.8); dialog text renders live; the handset readout logs it. `fsux-advance-guard` (Round 1)                                       |
| B4  | Score POST is an upsert on `SCORE#<round>#<athleteId>` (`scores/handler.ts:42-62`) — `New entry` silently overwrote the saved row          | `New entry` is **removed**; a saved panel unlocks only on athlete change (as `useScoreRecorder` documents) and links to the Scores page. The settled "corrections on the Scores page" constraint stands; no fourth confirm (§4.9, §7)                       |
| S   | Break-over (`BREAK_ZERO`, `PEER_BREAK_END`) still played `long`, the run-zero cue                                                          | Break-over gets `alert2` (`beep-alert2.mp3` already ships, unused); four channels, four tones (§4.2)                                                                                                                                                        |
| S   | Reset at 40 px contradicted C05                                                                                                            | Reset 44 px; the offset + the confirm are the guard, not size (§6)                                                                                                                                                                                          |
| S   | Plate acceptance "≤3 words each" contradicted the labels                                                                                   | Defined: right = verb ≤2 words + target name; left = state word ≤3 words + one live fact; the `then:` / reason sub-line is unbounded (§4.1)                                                                                                                 |
| S   | Round 1 "no visual change" was false (SelectField swap, RaceButton skin)                                                                   | Round 1 keeps only the overlay guard list; `RaceButton` + the `button`/`a[href]` guard entries land together with the plate; the SelectField swap lands with the desk (§4.3)                                                                                |
| S   | `useFreestyleBoard` extraction sat after three rounds of new page code                                                                     | `fsux-control-page-split` is Round 2, directly after the pure work                                                                                                                                                                                          |
| S   | `PEER_HINT` guards unpinned; the Lamport-only stamp is now load-bearing                                                                    | §4.11 pins the three no-op guards + the table row; notes the stamp                                                                                                                                                                                          |
| S   | Overall override: NaN, negative overall in battle, bounds upper-only                                                                       | §4.9                                                                                                                                                                                                                                                        |
| S   | `race.idle` on canvas 2.9:1 for the idle frame                                                                                             | §6: idle/held stroke `ink.mid` on the light variant; frame strokes join the contrast test                                                                                                                                                                   |
| S   | `fullBudgetMs` must not be the Run (s) field draft                                                                                         | §4.5: the source is the lane's `armedMs` (reducer); the field is a draft until `Set both lanes`                                                                                                                                                             |
| S   | Two missing manual sentences                                                                                                               | §4.8 (confirm-open press) and §4.13 (clocks keep running while Reconnecting) name them; `fsux-manual-freestyle-judging` carries them                                                                                                                        |

**Iteration 3 — blockers from the post-build critic pass** (2026-09-08, on the shipped board):

| #   | Blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Resolution (where)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B2  | `armedMs` off the snapshot poisons the room. A panel joining a room armed to anything but its own format default hydrates `budgetMs` and keeps that default as `armedMs` → it reads the lane as **held** (TURN TAKEN, `boardHoldsState` locks its mode toggle / Set both lanes), and its Reset — routine, once per quali athlete — broadcasts the default, which every peer applies as `PEER_RESET`. Not "cosmetic, realigns on Reset": it realigns to the wrong value and rewrites the room's armed budget | `armedMs` becomes one additive optional field on the `state_snapshot` countdown row, set by `laneSnapshot` in every phase and applied by `PEER_SNAPSHOT`. A pre-feature sender omits it: the receiver falls back to the lane budget on an **idle** lane and keeps its local value otherwise (§4.6). ADR 0046 §2 + Consequences amended — this is the snapshot change the PLANS guardrail requires an ADR for. One extra `realtime-recovery` step (§10)                                                 |
| B3  | The best-trick lane interlock contradicted itself on Reset. §2 C greyed **every** lane control ("Reset too"), while §4.7 and the PLANS spec said "Reset stays, asks first" yet listed pads 0/1/2/4 + 5/6/7/9 as inert — 1 and 6 **are** Reset (`LANE_BUTTONS.reset`, `LANE_2_OFFSET`). Three statements, two answers: the shipped board took the screen's, so the yellow key silently kept a re-arm path open behind the tries, on the one control with no undo                                             | Reset is **locked with the rest of the lane transport** while `trySeries !== null`, why-line `locked during best trick — Leave best trick first` (already `holdReason`'s word for the hold, so nothing new is worded). `laneLocks.reset` takes the board hold; the pad guard and the handset readout share it, so pads 1/6 are inert and log the lock. §4.7 + the §5 yellow row corrected; the manual's best-trick bullet follows                                                                      |
| B4  | `Leave best trick` was unconfirmed while it destroyed exactly the data `Reset series` confirms for. `DISARM` sets `series = null` (`bestTrickSeries.ts`) and the next `ARM` starts a fresh tally, so a stray Leave at 2/5 vs 3/5 in a final loses the counts the judge needs for the Best trick component — and §4.7's own why-line (`Leave best trick first`) steers the operator straight onto it. §4.8's "exactly three MUI confirms" excluded it: a C04 hole in the brief's own terms                   | Leave **shares** the Reset-series confirm once a try has been used — one dialog, `Keep series` autoFocused, registered with `useConfirmGuard`, so an ADVANCE press behind it answers safely and the readout logs `→ closed the Leave best trick dialog (Keep series)`. Leave on a fresh series stays instant, so it is still three questions; `seriesResetNeedsConfirm` becomes `seriesTallyNeedsConfirm` — the tally is what is at risk, not the press. §4.8 lists it; the manual §5 sentence follows |

**Iteration 4 — the fold budget, measured** (2026-09-25, `freestyle-board-fold-budget`; every
number below is a driver measurement of the shipped board, not arithmetic):

| #   | Finding                                                                                                                                                                                                                    | Resolution (where)                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | The desk's height gate promised what the desk could not keep. At 1280×800 — past the gate — End turn, Reset and Athlete 2's Save sat 62–145 px under the fold in **both** modes, and 1440×900 battle cleared by 2 px       | The gate's height half is **900**: the battle desk's last control now measures 879 and quali's 803, so 800 was never a threshold the layout could hold. Everything shorter takes the tab layout, which this pass makes fold-clean at 1280×720 and 1024×768 (`ControlPage.tsx`, `deskGeometry.ts`, manual §"big screen")                                                                   |
| F2  | `reserveBreakSpace` held **two** rows behind one prop: the held-run row (a quali break's paused budget) and the shared caption row (the `TIME` expiry word every lane reaches). Battle reserved both and breaks in neither | Split into `reserveBreakRows` + `reserveCaptionRow` (§4.12 unchanged in intent). The lane card reserves the caption always and the break rows only on the **quali desk** — the tab layout shows one step and mounts them on demand. −24 px per card (`Countdown.tsx`, `CountdownControl.tsx`, `ControlPage.tsx`)                                                                          |
| F3  | Three rows of the lane card were chrome: the peer chip's own reserved row, the step caption the tab beside it already prints, and Reset's own row under a dashed divider                                                   | The peer chip rides the identity row (the selection panel's own precedent); the caption prints on the desk only (`DeskSection.showCaption`); Reset shares the aux row behind the **same dashed divider turned on its side** — the S03 guard is "never flush beside Stop", and the far end of the card is further from Stop than a row below it was. DOM order keeps the tab run unchanged |
| F4  | The selection panel stacked a "Recording context" grid over a bordered "Athlete assignment" box, ~60 px of the live column that holds the lane transport over the fold                                                     | ONE wrapping row; the assignment trio is one wrap unit, so the manual's "stays together" is a property of the row rather than a box drawn round it. The Match select's permanent helper line goes with it (setup chrome collapses before the live path does)                                                                                                                              |
| F5  | The score rail's panels were 350 px each: a 20 px MUI body helper under every judged field, a title that wrapped on a long athlete name, and 8 px rhythm throughout                                                        | Helper leading tightened to its own (the line carries `max 40`, never a paragraph), the title held to one line like the lane card's name, rhythm to 0.75. Athlete 2's Save clears 900 by 25 px with both panels saved. The status slot keeps its 52 px reserve — lowering it made a save landing move Save, which is the slot's whole job                                                 |
| F6  | `control-link-detail` helped SIZE the health column it sits under: a longer alarm sentence measurably narrowed the plate row (77.3 → 57.3 px at 1440×720)                                                                  | `width: 0` + a percentage floor — no intrinsic contribution, full width once the column is settled (`ftt-followup-speedline-desk-fold-2`)                                                                                                                                                                                                                                                 |

> Not resolved here: at `md` (900–1200) the health grid is still two rows of two, because four cells
> in a third of a tablet is what `5a69ad8` measured as worse — and shortening `AUDIO LOCKED — click
anywhere` is the owner call parked in `ftt-followup-driver-green-baseline-2`. The rail-foot
> `Reset lanes for the next match` (offered only once both scores are saved) is still under the fold
> on the compact Score tab and the ≤900 desk; its two per-lane twins are not.

## 1. Thesis

The reducers already know everything the operator needs — lane phase, `lastRan`, `advanceTarget`,
break allowance, `currentTurn` — and the board says almost none of it. The redesign adds **no new
timer state** beyond one per-lane number (`armedMs`, the budget a lane was last armed with, §4.6);
it renders what exists, once, in the right place:

1. **One plate above the lanes** — the **TALLY plate** — carries the live state word on its left
   (`RUNNING · P1 BIANCHI`, `CHANGEOVER · 00:12`, `BATTLE OVER`) and, on its right, what the next
   ADVANCE press will do (`STOP · Player 1 · C. Bianchi`). Both are rendered from the **same pure
   route** the press dispatches (`advanceRoute` → `advanceLabel`), so the plate cannot lie. It is
   filled in the race colour of its verb, so it is the loudest object on the page. It is also the
   screen twin of the buzzer: a click dispatches the identical event.
2. **A fixed three-column desk** (248 | fill | 360 at ≥1280×800) where **nothing moves** between
   states: setup controls lock grey in place rather than collapsing, every conditional element has a
   reserved slot, the connection/audio chips swap inside a fixed header slot.
3. **Two named predicates** replace the three ad-hoc ones in the page: `boardLive` (something is
   ticking → leave guard, warm-up/lane field locks) and `boardHoldsState` (something is destroyable →
   mode toggle, Set-both-lanes). Locks replace confirms; the two native `window.confirm`s go.
4. **The live path gets its own control contract**, separate from setup/score chrome: Start/Stop at
   ≥56 px in the state colour, Reset neutral and offset, a why-line under every disabled race control,
   the race palette reserved for state, every text pair ≥4.5:1 by test.
5. **Every non-happy path is a rendered state**: NOT SAVED + Retry per player, AUDIO LOCKED, awaiting
   board state, peer-applied chips, a no-op press that answers with the reason.

Rejected from the review, and why: auto-folding cue rows (controls move under the hand — rubric C14,
the operator's worst failure), a 5 s Undo snackbar (unnecessary once `boardHoldsState` gates the
format controls — re-picking is the undo), a ≤2 s Start gate while awaiting peers (a dead board for
every solo operator on every reload; newer-wins snapshot merge already bounds the risk — awaiting takes
§3's left half and nothing else), `lastRan` on the wire (derivable from the already-relayed
`LiveSelection.nextUp` — see §4.11), a dark glossy GO rail (sunlight glare), a live-board `New entry`
(an upsert overwrite in disguise — §4.9).

## 2. The desk — wireframes

Column widths 248 | fill | 360, gaps 16, header 52 px. The live column caps at **800 px** — two
lane cards plus the changeover gutter read as one board — and the sticky plate takes that same
ceiling, so its verb sits over the lane it names instead of out across the desk. **Quali is exempt**:
at its 500 px deck the `TAKE BREAK` verb wraps its §4.12 slot at the 1920 type scale and steps the
whole board, so there the plate keeps the column (measured in a browser, `fsux-tally-plate-width`).
Outside **1280×800** the three columns are replaced
by `CompactBoardLayout` (round 10, `fsux-progressive-disclosure-mobile`): a `Tabs` row — Setup,
Selection, Run, Best trick (battles only), Score — with the plate `position: sticky` above it, and
only the active tab's section mounted (the read-when-needed handset map moves the same way, behind
`BuzzerMappingDialog`'s trigger). The active tab tracks `boardStep`, so the board opens on — and
follows — whichever step the operator is on; a manual tab pick is the exception, not the norm.
The desk gate is width **and** height (`fsux-desk-fold-budget`): a 1280×720 screen is wide enough
for three columns and 80 px short of holding them, so it took the desk and put the lane transport
under the fold — height is the scarce axis on a laptop, and the tab layout is the answer to a short
screen exactly as it is to a narrow one. The header pays into the same budget: its health block is
ONE row of four cells at ≥`md` (Link · Audio · peer · a compact sound icon-toggle) over the detail
caption, ~47 px rather than the ~125 px the 2×2 grid plus a full-width sound button cost — shared
with the Speedline console. Quali's selection row is likewise flat: Round · Gender · Athlete 1 ·
Next up in one grid, no nested "Athlete assignment" box (battle keeps it — Athlete 1 / Swap /
Athlete 2 needs ~480 px). _Iteration 4 (F4) took the box off battle too: the whole selection is one
wrapping row and the trio is one wrap unit in it._

Every wireframe below is the wide-desk (≥1280×900 since iteration 4, F1) layout; the compact layout carries the same
sections, one tab at a time, each still numbered and still marked current the same way. Vocabulary is
the manual's:
**Player 1 / Player 2**, Start / Stop / Reset, Take break (quali) / End turn (battle), Start try /
End try, ADVANCE.

```
A · SETUP (battle selected, idle) ──────────────────────────────────────────────────────── 1440
 Demo Cup  [Freestyle] [BATTLE] [Final · Women] [Recording]   (● Connected · peer answered)(🔊 audio armed)
┌ 248 ─────────────────────┐ ┌ live column ─────────────────────────────────────────┐ ┌ 360 ────────────────┐
│ 1 · SETUP                │ │▓ READY · TURN 1      [SPACE] [HANDSET 3 ●]           ▓│ │ 6 · SCORE ENTRY     │
│ [Quali 2:00/5:00][BATTLE]│ │▓ START · Player 1 · C. Bianchi   then: a press ends  ▓│ │ ┌ P1 · C. Bianchi   │
│ Run (s)[150] Warm-up[420]│ │▓ the turn · both budgets 02:30                       ▓│ │ │ [not entered]     │
│ [Set both lanes 150 s]   │ │  (go fill, ink.hi text — verb START)                  │ │ │ Difficulty [ ]/40 │
│ Preview ON · links       │ │ 3 · SELECTION  Round[Final] Gender[Women]             │ │ │ Combo      [ ]/30 │
├──────────────────────────┤ │   Match[Final #1 Bianchi vs Lafleur] P1[…] ⇄ P2[…]    │ │ │ Style      [ ]/30 │
│ HANDSETS  none detected  │ │ 4 · RUN                                               │ │ │ Best trick [ ]/20 │
│ press any button to      │ │ ┌ READY ───────────┐ CHANGE- ┌ READY ───────────┐     │ │ │ Penalty    [ ]    │
│ reveal · last: —         │ │ │ PLAYER 1 Bianchi │ OVER    │ PLAYER 2 Lafleur │     │ │ │ Overall 0.00 comp │
│ red→Start(green on scrn) │ │ │      02:30       │  —      │      02:30       │     │ │ │ [ SAVE (Enter) ]  │
│ blue→Stop  yellow→Reset  │ │ │ [▓START▓][ STOP ]│         │ [ START ][ STOP ]│     │ │ │ [ DNF ]           │
│ green→End turn orange→Try│ │ │ why: —   no turn │         │ why: —   no turn │     │ │ └───────────────────┘
├──────────────────────────┤ │ │ [ End turn ]     │         │ [ End turn ]     │     │ │ ┌ P2 · R. Lafleur … │
│ 2 · WARM-UP   ARMED      │ │ │ ─ ─ ─ [↺ Reset] │         │ ─ ─ ─ [↺ Reset] │     │ │ Winner: — after     │
│      07:00  (half scale) │ │ └──────────────────┘         └──────────────────┘     │ │ both saves          │
│ [Start][Stop][Reset] 44px│ │ 5 · BEST TRICK  [Begin best trick · 5 tries · 30 s]   │ └─────────────────────┘
└──────────────────────────┘ └───────────────────────────────────────────────────────┘

B · RUN — Player 1 running (battle) ────────────────────────────────────────────────────────
│ 1 · SETUP  (format controls grey, why: locked while Player 1 runs; preview toggle live)
│▓▓ RUNNING · P1 BIANCHI  02:14 left        STOP · Player 1 · C. Bianchi   then: start Player 2 ▓▓│  (stopDim fill, white)
│ 4 · RUN  ╔ RUNNING ══════════════╗  CHANGEOVER  ┌ READY · NEXT UP ─────┐
│          ║ PLAYER 1  C. Bianchi  ║     —        │ PLAYER 2  R. Lafleur  │
│          ║      02:14 (runText)  ║              │      02:30            │
│          ║ [ START ][▓ STOP ▓]   ║              │ [ START ][ STOP ]     │   why: locked while Player 1 runs
│          ║ [ End turn ] (=Stop)  ║              │ [ End turn ]          │
│          ║ ─ ─ ─ [↺ Reset] asks  ║              │ ─ ─ ─ [↺ Reset]       │
│          ╚═══════════════════════╝              └───────────────────────┘
│ 5 · BEST TRICK  [Begin best trick] why: a lane runs
  changeover: plate → go fill "START · Player 2 · R. Lafleur"; gutter shows CHANGEOVER 00:12 (setDim, half
  scale); Player 1's card turns dashed ┄ TURN TAKEN · 02:14 held ┄ so a lane that ran never looks READY.

C · BEST TRICK — try open (both budgets spent) ─────────────────────────────────────────────
│▓▓ TRY · P2 LAFLEUR · 2/5  00:21 left      END TRY · R. Lafleur   then: C. Bianchi's try 3 of 5 ▓▓│
│ 4 · RUN  two FINISHED · TIME cards (thin stopDim frame, stopDim 00:00), every lane control grey,
│          why: locked during best trick — Leave best trick first (Reset too)
│ 5 · BEST TRICK  [3][5] tries  Try (s)[30]              [Reset series] [Leave best trick] both ask
│    C. Bianchi 2/5        ╔ Try open · R. Lafleur ══╗        R. Lafleur 2/5 · on the line
│    [ START TRY ] (56)    ║        00:21           ║        [ START TRY ] (56) why: a try is open
│    [Skip]                ╚════════════════════════╝        [Skip]
│                              [▓▓ END TRY ▓▓] (56)

D · SCORE — both spent, P1 saved, P2 save failed ───────────────────────────────────────────
│░░ BATTLE OVER · SCORE                     NOTHING TO ADVANCE — Begin best trick or Reset a lane ░░│
│░░ P1 SAVED 26.00 · P2 NOT SAVED — retry                                                        ░░│  (panel fill, ink text)
│ right rail:  P1 · C. Bianchi  [SAVED 26.00]  fields readOnly (full ink) · locked — correct it on the Scores page ↗
│              P2 · R. Lafleur  [NOT SAVED · network] [Retry save]  values kept · timing unaffected
│              Winner: — waits for Player 2 save        [↺ Reset lanes for the next match]
```

Quali: the run deck is one centred card (max 500 px), the aux slot reads `Take break (n left)`,
section 5 is absent and Score is numbered 5 (the manual says so). The plate's verb cycles
`START` → `TAKE BREAK` → `RESUME` → `NOTHING TO ADVANCE — Reset is manual`, while its left half
counts `01:40 left · 2 breaks` → `00:22 · 1 left · 01:58 held` under the state word.

## 3. State → UI

Every row is a pure function of `(mode, battle, trySeries, warmup, peerState, socket, score[player])`.

| State                                           | Plate (left · right)                                                                                                                                                                                                                                                                                                                                    | Lanes / panel                                                                                                                                                                                                                  | Primary press                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Opened, `request_state` sent, no answer (≤2 s)  | grey, **left half only**: `AWAITING BOARD STATE…  a peer panel may still answer`; the right half keeps the real promise (`START · Player n · name`). The hedge yields the moment this board holds something of its own (`boardHoldsState`) — its subject is a joiner drawing its defaults as if they were the match (S13), never a turn this board took | cards drawn idle, digits `ink.mid`; header `peer: awaiting`; **nothing disabled**                                                                                                                                              | ADVANCE, as ever; timeout → `alone` |
| Idle, no athlete/match                          | grey `IDLE · ARMED` · `SELECT AN ATHLETE`                                                                                                                                                                                                                                                                                                               | READY cards; header `Not recording` red                                                                                                                                                                                        | Selection                           |
| Ready (selection set, budgets full)             | go `READY · TURN 1` · `START · Player n · name`                                                                                                                                                                                                                                                                                                         | target lane Start contained `go`, other outlined; gutter `—`                                                                                                                                                                   | ADVANCE → START(target)             |
| Battle lane running                             | stop `RUNNING · Pn NAME  mm:ss left` · `STOP · Player n · name`                                                                                                                                                                                                                                                                                         | running card wide teal frame, `runningText` digits, word RUNNING; other card locked (why-line); Begin best trick locked                                                                                                        | ADVANCE → STOP                      |
| Battle changeover                               | go `CHANGEOVER · 00:12` · `START · Player m · name`                                                                                                                                                                                                                                                                                                     | ran lane dashed `TURN TAKEN · mm:ss held`; gutter count-up setDim half scale                                                                                                                                                   | ADVANCE → START(target)             |
| Battle last turn running (partner spent)        | stop `RUNNING · Pn NAME  mm:ss left` · `STOP · Player n · name`, sub-line `then: start … again` while the stopping lane's own budget survives, `then: nothing to advance — Begin best trick or Reset a lane` once it does not                                                                                                                           | partner card FINISHED · TIME; running card as above                                                                                                                                                                            | ADVANCE → STOP                      |
| Battle last turn ended (the same athlete again) | go `AGAIN · Pn NAME  mm:ss held` · `START · Player n · name`                                                                                                                                                                                                                                                                                            | ran lane dashed `TURN TAKEN · mm:ss held`; gutter counts the gap under the caption `PAUSE` — nobody changes over                                                                                                               | ADVANCE → START(same lane)          |
| Battle both spent                               | grey `BATTLE OVER · SCORE` · `NOTHING TO ADVANCE — Begin best trick or Reset a lane`                                                                                                                                                                                                                                                                    | FINISHED · TIME cards, thin stopDim frame; Begin best trick is the only contained control                                                                                                                                      | Begin best trick / type scores      |
| Best trick armed, no try                        | go `BEST TRICK · Pn NEXT  try k of cap` · `START TRY · name`                                                                                                                                                                                                                                                                                            | lanes locked (why: locked during best trick); suggested side Start try contained                                                                                                                                               | ADVANCE → START_TRY(currentTurn)    |
| Try open                                        | stop `TRY · Pn NAME · k/cap  00:21 left` · `END TRY · name`                                                                                                                                                                                                                                                                                             | try clock wide teal frame; both Start try locked (why: a try is open)                                                                                                                                                          | ADVANCE → END_TRY                   |
| Series complete                                 | grey `BEST TRICK DONE · SCORE` · `NOTHING TO ADVANCE — enter scores`                                                                                                                                                                                                                                                                                    | k/k both sides                                                                                                                                                                                                                 | type Best trick component           |
| Quali running, breaks left                      | set `RUNNING · NAME  mm:ss left · n breaks` · `TAKE BREAK · Player n · name`                                                                                                                                                                                                                                                                            | Stop contained stopDim (deliberate); Take break 44 px enabled                                                                                                                                                                  | ADVANCE → TAKE_BREAK                |
| Quali running, no breaks                        | grey `RUNNING · NAME` · `NOTHING TO ADVANCE — Stop is manual`                                                                                                                                                                                                                                                                                           | Take break grey, why: no breaks left                                                                                                                                                                                           | Stop (manual)                       |
| Quali break / hold at zero                      | go `BREAK  00:22 · n left · mm:ss held` → `HOLDING  mm:ss held` · `RESUME · Player n · name`                                                                                                                                                                                                                                                            | card wide amber frame, break numeral setDim, state word `setText`, held run row `ink.hi`; Start contained go; zero → `alert2`                                                                                                  | ADVANCE → START                     |
| Quali finished                                  | grey `TIME · SCORE` · `NOTHING TO ADVANCE — Reset is manual`                                                                                                                                                                                                                                                                                            | FINISHED · TIME card                                                                                                                                                                                                           | Save (Enter)                        |
| Warm-up running / over                          | plate unchanged (outside the cycle); sub-line appends `warm-up 04:12`                                                                                                                                                                                                                                                                                   | left card: RUNNING half-scale teal frame → `WARM-UP OVER` stopDim + 44 px `Re-arm 07:00` in the **same slot**; `alert`                                                                                                         | Start / Re-arm (mouse)              |
| Score per player                                | grey plate sub-line mirrors `P1 SAVED 26.00 · P2 NOT SAVED — retry`                                                                                                                                                                                                                                                                                     | status slot always rendered: `not entered` → `SAVING…` → `SAVED n` / `NOT SAVED · reason` + Retry; saved = readOnly + link                                                                                                     | Save (Enter) / Retry                |
| Socket not OPEN                                 | sub-line appends `· preview not receiving`                                                                                                                                                                                                                                                                                                              | header chip swaps to amber `Reconnecting…` in the same slot, over the reserved line that carries `clocks keep running; the preview is not receiving` (in the chip the label wrapped the row in two); every clock keeps ticking | keep operating                      |
| Audio blocked                                   | sub-line appends `· audio locked`                                                                                                                                                                                                                                                                                                                       | header chip red `AUDIO LOCKED — click anywhere` (existing `AudioMutedBadge`)                                                                                                                                                   | any gesture                         |
| Peer-applied event                              | plate re-renders from mirrored state on the same frame                                                                                                                                                                                                                                                                                                  | affected card's reserved peer chip `by other panel` for 2 s; Selection row flashes `changed by another panel`                                                                                                                  | nothing — the board is already true |
| ADVANCE on a no-op                              | plate flashes grey 1 s with the reason; plays `alert`, never `short`                                                                                                                                                                                                                                                                                    | no state change; the readout logs `→ NOTHING TO ADVANCE — <reason>`                                                                                                                                                            | read the reason                     |
| Handset key an interlock blocks                 | plate flashes grey 1 s carrying the lock's own reason in the sub-line; plays `alert`, and the verb keeps promising what ADVANCE would do                                                                                                                                                                                                                | no state change; the readout logs `→ locked: <reason>`                                                                                                                                                                         | read the reason                     |
| Reset on a lane holding a turn                  | —                                                                                                                                                                                                                                                                                                                                                       | MUI dialog `Player 1 holds 02:28 of 02:30 — resetting re-arms to 02:30` (text live from the store), **Keep timing** autoFocused                                                                                                | Keep timing                         |
| Reset on a finished or pristine lane            | —                                                                                                                                                                                                                                                                                                                                                       | re-arms on the press, no dialog — the clear for the next athlete or the next match                                                                                                                                             | Reset                               |
| Reset series / Leave best trick, a try used     | —                                                                                                                                                                                                                                                                                                                                                       | one MUI dialog for both presses: the tally line is shared and live from the store (`Aiko has used 2 of 3 tries, Bruno 1`), the verb names the press, **Keep series** autoFocused                                               | Keep series                         |
| Reset series / Leave best trick, fresh series   | —                                                                                                                                                                                                                                                                                                                                                       | applies on the press, no dialog — nothing has been spent to lose, so the board still asks exactly three questions                                                                                                              | the press                           |
| ADVANCE while a confirm is open                 | — (plate is under the modal backdrop)                                                                                                                                                                                                                                                                                                                   | Space / pad 10 / plate click all = the confirm's safe action (dialog closes, nothing dispatched); handset readout logs it                                                                                                      | press again to advance              |

## 4. Interaction contract

1. **One press = one reducer event.** `advanceRoute(mode, battle, trySeries)` (new
   `app/util/advanceRoute.ts`) returns `{ machine: 'battle', event } | { machine: 'try', event } |
{ kind: 'noop', reason }`; `advanceLabel(route, names)` renders it. Space, pad 10 and the plate
   click all call one `onAdvance()` that dispatches the returned event. Router order: a running lane →
   STOP first; else armed series → END_TRY / START_TRY(currentTurn); else ADR 0037 §2/§3 cycles. The
   interlocks (§4.7) make "running lane + armed series" unreachable; the order is pinned anyway.
   **Label shape** (the acceptance measure): right = verb ≤2 words + the target name
   (`END TRY · R. Lafleur`); left = state word ≤3 words + one live fact (`RUNNING · P1 BIANCHI  02:14
left`); the `then:` / no-op reason sub-line is unbounded. The live fact is the left half's
   **alone** — a clock, a break allowance, a held run, the attempt a try opens. Only the left half
   re-renders on the tick, so the same number beside the verb is a second-old copy of the one the
   fact slot is counting: where a §3 row writes one on the right (`TAKE BREAK (n left)`), read it as
   shorthand for the left half's. `advanceLabel` holds the line, pinned over the whole press table.
   The plate being one button also fixes what a screen reader gets: its accessible name is the
   press (`ADVANCE — <verb> <target>`), and the state report it wraps rides a visually-hidden
   `role="status"` sibling of the button, so neither half is said twice and the click target is
   never split (`fsux-board-heading-semantics`).
2. **Cue after decide.** `short` plays only on a non-noop route; a no-op plays `alert` and flashes
   the plate grey for 1 s with the reason. **Four channels, four tones**, set in each reducer's effect
   table and pinned by the table tests: run zero `long` (`TIMEOUT`); quali break-over `alert2`
   (`BREAK_ZERO` — was `long`, indistinguishable from run zero); warm-up expiry `alert`; try end
   `short`. `useSignalAudio` widens to `'short' | 'long' | 'alert' | 'alert2'`. **An expiry horn
   sounds on the panel whose own clock crossed zero** — `PEER_STOP` at zero and `PEER_BREAK_END` are silent, so two panels at one desk
   are one horn (ADR 0046 §5); the mirrored `short` start/break cue stays, and the header's
   persisted per-device `Sound on this panel` chip moves the whole panel's tones when the PA hangs
   off the other box. **The four files separate on burst count before pitch** — a pitch step is what a
   PA in a tent throws away first: `short` one burst 0.5 s / 452 Hz, `long` one 1.0 s / 904 Hz,
   `alert` six warbling over 2.4 s / 1034 Hz, `alert2` two taps 0.5 s / 1034 Hz. The `beep-alert2.mp3`
   that shipped unused was `alert` truncated — same recording, same warble, apart only in where it
   stopped (0.9 s, within 100 ms of `long`), so nothing named the cue until it ended; it was re-cut
   from that recording's own first burst as two taps with real silence between. The table is the
   spec any re-cut has to land — the measurement is a decode, the judgement a listen.
3. **ADVANCE guard — one predicate, three triggers.** `advanceBlocked()` (in `useAdvanceInput`)
   returns the open confirm's safe close while `[role=dialog], [role=listbox], [role=menu]` exists,
   else null; Space, pad 10 and the plate click consult it first (§4.8 says what they do). Space
   additionally bails when `document.activeElement` owns keystrokes: `input, textarea, select,
[contenteditable], [role=combobox], [role=listbox], [role=option]` (Round 1) and `button,
[role=button], a[href]` (lands **with** `RaceButton`, §4.4 — widening to `button` before every live
   control blurs would let a mouse-clicked Start swallow the next buzzer press); ignores
   `event.repeat`; `preventDefault` otherwise. A focused button + Space is the browser's native click of
   that button (one action, never two). Round/Gender move to the house native `SelectField` with the
   desk layout so an open list can never own Space.
4. **RaceButton.** Every control in the live column (plate, Start, Stop, End turn, Take break, Start
   try, End try, Save, Retry, Re-arm) renders through one `RaceButton` wrapper: `onMouseDown`
   `preventDefault` (a mouse press never takes focus) + blur after click, so a mouse press can never
   capture the next buzzer Space. Pinned by a test: click Stop, press Space, assert the route dispatched.
5. **Two predicates and one scoped hold, named consumers.**
   `boardLive = runningLane !== null || breakOpen || (mode==='battle' && pauseStartedAt !== null) || warmup.running || trySeries?.clock.running`
   → `useRunGuard`, the lane-budget / warm-up second fields (each also by its own running flag).
   `boardHoldsState = boardLive || trySeries !== null || any lane.phase !== 'idle' || any lane.budgetMs !== lane.armedMs`
   → mode toggle, Set-both-lanes. **`armedMs` is the reducer's per-lane "last armed to" value (§4.6),
   never the Run (s) field** — typing a new value must not flip idle lanes to "holds state" and lock
   the very button that applies it.
   `playerHold = boardHold` **with the warm-up taken out** → `Swap players` (§4.7). Asked of the
   whole board, not of `boardHold`'s answer: warm-up outranks `bestTrick`/`held`/`spent` in that
   walk, so skipping the reported hold would unlock a swap over a spent lane whenever a warm-up ran.
   Setup **never collapses**; each locked control shows its blocker.
   Preview toggle, projector links and the athlete pickers are never locked.
6. **Locks replace confirms; `SET_BUDGETS` is relayed and pristine-only.** Both `window.confirm`s
   are deleted. Every `LaneState` variant carries `armedMs` (set by `RESET` / `PEER_RESET` /
   `SET_BUDGETS` / `PEER_SNAPSHOT`; untouched by START/STOP/breaks). **The room owns it, so it rides
   the `state_snapshot` row** — one additive optional field on `CountdownTimerRow`, written by
   `laneSnapshot` in every phase (a spent lane still knows what a Reset would re-arm it to) and
   applied by `PEER_SNAPSHOT`. A joiner that kept its own format default instead read a mirrored lane
   as held and re-armed the whole room to that default on its next Reset (iteration 3, B2 — ADR 0046
   §2). Pre-feature senders omit the field; the receiver then falls back to the lane budget on an
   **idle** lane (its remaining IS an armed budget, so the lane reads pristine) and keeps its local
   value on running / on-break / finished, where the spent-down remaining says nothing about it.
   A lane is **pristine** when `phase === 'idle' && budgetMs ===
armedMs`. `SET_BUDGETS { budgetMs }` re-arms only pristine lanes (fresh allowance, `lastRan` null) and
   emits one `{ type: 'reset_countdown', timerId: lane, data: { remainingMs } }` **per lane it
   re-armed** — the same message `RESET` sends, so peers apply `PEER_RESET` and the preview/athlete
   display mirror (today's two-RESET path did this; iteration 1 lost it). Mode switch applies
   immediately under `boardHoldsState` via one `applyFormat(next)` (mode + stored mode + Run (s)
   draft + warm-up default) shared by the local path (then `SET_BUDGETS`) and the peer path (no
   dispatch — the peer's `reset_countdown`s arrive on their own). The Run (s) field is a **draft**
   applied by `Set both lanes`; a single-lane Reset re-arms to that lane's `armedMs`. Table rows:
   pristine + pristine → two effects; pristine + held → one effect, held lane untouched; finished lane
   untouched; `PEER_RESET` sets `armedMs = remainingMs`; `PEER_SNAPSHOT` sets `armedMs` to the wire
   value, and with none to the lane budget on an idle lane / the local value on any other phase.
7. **Interlocks** (each with a why-line): while a lane runs → other lane's Start/Stop/Reset/End turn,
   Begin best trick, Start try; while the series is armed → both lanes' Start/Stop/Reset/End turn/Take
   break + pad indices 0/1/2/4 and 5/6/7/9 (the lane's four keys; only the orange try key stays live),
   all reading `locked during best trick — Leave best trick first`. **Reset is locked with the rest**
   (§2 C): the run board is re-armed for the next match _after_ Leave best trick — one exit, rather
   than a second re-arm path that reaches the clocks from behind the tries and has to answer a confirm
   of its own. The score rail's `Reset lanes for the next match` fires those same two per-lane RESETs,
   so it takes the same lock (`resetBothLock`, §4.9) — otherwise the interlock keeps a door at the
   rail foot; Setup's mode toggle and `Set both lanes` are the third re-arm path and take it through
   `boardHoldsState` (§4.5), same hold, same words — the manual's §5 lock bullet names all three.
   While a try is open → both Start try, Skip, cap, Try (s); Stop unless its lane runs;
   Start when finished (`budget spent — Reset
re-arms mm:ss` from `armedMs`). Warm-up locks nothing but its own seconds field — and the selection
   row's `Swap players` is the one control whose hold it does not reach (`playerHold`, §4.5): the
   swap exchanges the two athletes and their score panels but neither the lane clocks nor the try
   tally, both slot-keyed, so every other hold misattributes it, while the warm-up is exactly the
   window the next pair is set up in. Speedline's `Swap` takes the same lock out of its own map (§7).
8. **Exactly three MUI confirms**, safe default autoFocused, Esc cancels: lane Reset when the lane
   still holds a turn that would have to be **re-timed** — `phase === 'running' || phase === 'onBreak'
|| (phase === 'idle' && budgetMs !== armedMs)` (text names the value at risk, **rendered live from
   the store** so a peer event cannot stale it); Round/Gender over a selected match (ADR 0033,
   unchanged); the best-trick tally once a try has been used — **`Reset series` and `Leave best
trick` share it** (`seriesTallyNeedsConfirm`), because both discard the same unrecoverable counts:
   `DISARM` drops the series and the next `Begin` starts a fresh tally, so an unguarded Leave is the
   same loss by another verb — and §4.7's why-line points every locked lane control at it. One
   dialog: the tally line is shared, the verb names the press (`Keep series` either way), and Leave
   on a fresh series stays instant, like Reset on one. A **finished** lane
   is not one of them: it holds nothing (freestyle records no time, the budget is spent) and its Reset
   is the board's most-repeated press — it ends every quali athlete cycle (TIME → Save → pick the next
   → Reset) and every battle — so a question there is the class-(b) confirm C04 punishes, and it would
   train the operator to click through the one that matters. Reset on a pristine **or finished** lane,
   Start, Stop, Take break, Save, mode, Set-both-lanes: no confirm; what keeps a spent lane from being
   re-armed by accident is the lock it lays on mode / Set-both-lanes (`locked while Player 1 has run —
Reset Player 1 first`, §4.5) and Reset's own offset behind the dashed divider (§6).
   **ADVANCE while a confirm is open = the confirm's safe action and nothing else**: Space lands on
   the autoFocused safe button (native click), pad 10 calls `advanceBlocked()`'s safe close, the plate
   sits under the modal backdrop (backdrop click
   → `onClose` → safe). The handset readout logs `→ closed the Reset Player 1 dialog (Keep timing)`
   — every question is named for the control that **raised** it, in that control's own words and off
   its own owner, since both readout lines send the operator to it: a lane confirm for its lane
   (the `controlName` seam, §10 — the battle board stands one per card), the Round/Gender confirm for
   the change it asks about (`Change gender` / `Change round`, one dialog over two pickers), the
   rail's for its `Reset lanes`. A name typed a second time at the registration drifts, and a fixed
   one on a question a board stands two of points at nothing. The **screen** renders that one
   expression too — the dialog's title (`Reset Player 1?`, so the question's accessible name is its
   own) and the destructive answer (`Reset Player 1`) — since the modal covers the card that raised
   it, and a readout sending the operator to `Reset Player 2` over a board-wide `Reset this
countdown?` names a control the screen does not carry. Manual
   sentence: "a buzzer press while a question is on screen answers it safely — press again to advance."
   Page test: open the Reset dialog → Space / pad 10 / plate click → identical outcome (dialog closed,
   lane still running, nothing dispatched). **Every other handset key is inert while the question
   stands** (§4.7's last interlock): the lane and try pad effects bail on `overlayOwnsBoard()` before
   their own locks, so the pad — the one path that reaches the transport from behind a modal backdrop
   — cannot Start, Stop, Reset or open a try under an unanswered question, and the readout names the
   way out (`→ locked: answer the Reset Player 2 question first`; a bare picker keeps
   `a picker is open`).
9. **Score entry.** Each player panel is a `<form onSubmit>` with a `type=submit` Save; field order
   = the manual (Difficulty, Combo, Style, Best trick, Control penalty, Overall); the cap is a permanent
   end adornment (`/ 40`, `− uncapped`); `inputMode='decimal'`, `onWheel` blurs; over-max → red +
   Save disabled. Overall override: `'' → null` (back to computed), `NaN` rejected (field error, Save
   blocked), a visible `use computed` action while overridden; bound **upper-only** `≤ sum(visible
maxima)` client **and** server (`validators.ts`) — a negative overall is legal in battle (uncapped
   penalty). A saved panel is `readOnly` + a lock adornment (full ink) with the line `locked — correct
it on the Scores page ↗`; it unlocks only when the athlete changes (`useScoreRecorder` already
   documents this). The link carries the panel's own athlete + round
   (`util/scoresLink`, which the Scores page seeds its filters from), so the one manual path the
   board keeps lands on the one row it means — an athlete the roster doesn't have is dropped rather
   than shown as an empty table. **`New entry` is removed**: the score POST upserts on `SCORE#<round>#<athleteId>`
   reusing the `scoreId`, so a second save from the board silently overwrote the persisted row — a
   live-board correction path the manual forbids and an unconfirmed irreversible action. The status
   slot always renders; `recordMatchResult` runs only in the `mutateAsync` success branch;
   `updateMatch` errors get their own winner-line retry; the winner line labels `Recorded winner
(earlier entry)` vs `derived from both saved scores`. `Reset lanes for the next match` (one 44 px
   button at the rail foot once both are saved) reuses the per-lane rule, lane by lane — so the
   ordinary end of a battle (both lanes spent) re-arms in one press, and only a lane still holding a
   turn raises the question. It reuses the per-lane **interlock** the same way (`resetBothLock` over
   `laneLocks`): inert, with the why-line under it, whenever either lane's own Reset is — a lane
   running or a series armed (§4.7) — and a lock landing while its question stands closes the
   question, since the answer behind it is no longer a press the board allows. Its question's
   **text** is that same rule applied to the sentence: one `laneHoldsPhrase` clause per holding
   lane, joined by `·`, then one shared tail — `— resetting re-arms both lanes for the next
match. The saved scores are not affected.` The clauses are the **cards'** own words (owned once in
   `resetGuard.ts`, so the two questions cannot word one risk two ways); the tail is the **rail's**
   own and names a **scope** where the card names a value (`re-arms to mm:ss`), because the two
   lanes may be armed to different budgets and each named lane already carries its own target in
   `of mm:ss`. A spent lane is re-armed by the press but stays out of the sentence — naming a lane
   that holds nothing is the class-(b) noise C04 punishes, and the tail is what says it goes too.
10. **Peer panels (ADR 0038 unchanged).** Any panel may act; the plate, cards and chips mirror peer
    events on the same frame; each peer-applied START/STOP/selection shows a 2 s chip in a reserved
    slot; the header shows `peer: awaiting → answered / none` (inferred from `state_snapshot` /
    `updateSelection` replies — the relay has no presence). Data-plane writes stay bound to the local
    click/Enter.
11. **Alternation survives a rejoin without a wire change.** On a peer `updateSelection` carrying
    `nextUp`, the joiner dispatches `PEER_HINT { nextUp }` → `lastRan = otherLane(nextUp)`; `PEER_SNAPSHOT`
    sets `lastRan` to the running lane when one is running. `advanceTarget` reproduces the correct target
    from that in every branch (`lastRan` null / other lane finished / same lane finished), so `lastRan`
    never rides the snapshot (PLANS guardrail intact). **Guards, pinned as table rows:** `PEER_HINT` is a
    no-op when `nextUp === null`, when `mode !== 'battle'`, or when a lane is running; plus the row
    "peer `nextUp = X` because `other(X)` is finished → `lastRan = other(X)`, target still X". Note: the
    joiner's own default `nextUp` cannot poison the room only because a panel that has not yet accepted an
    incoming stamp mints Lamport-only (`useControlSession.tsx` `stampAnchoredRef`) — that gate is now
    load-bearing for this feature; its comment says so.
12. **Layout stability.** Reserved slots: plate min-height (verb wraps inside), state word, name row
    (nbsp), lane sub-line, why-lines (14 px), break rows, warm-up transport/re-arm (one 44 px slot),
    peer chip, score status slot **and the Save/DNF row under it** (kept, disabled, on a locked
    panel — the status slot already says why, and the DNF target stays where the hand left it),
    field helper text, the CHANGEOVER gutter (always rendered, `—` when
    idle). No toast over the live column (recorder toast → top-right, additive). Health chips swap
    inside one fixed header slot, and the link's alarm sentence rides a reserved line **under**
    them (nbsp while the link is healthy) — inside the chip its ~400 px label wrapped the 720 px
    row in two and pushed the desk down on every outage.
13. **Socket down.** Controlled clocks drop the `display: none` gate (the gate stays only where
    `display` is message-driven — the feed surfaces). ADVANCE, transport, expiry timeouts and local
    beeps keep working. Manual sentence: "clocks keep running while the board shows Reconnecting… —
    the preview is the only surface not receiving."
14. **Handsets.** The card is always rendered (empty state `no handset detected — press any button
to reveal it`); rows come from exported constants (`LANE_BUTTONS {start:0, reset:1, aux:2, try:3,
stop:4}`, `LANE_2_OFFSET 5`, `ADVANCE_BUTTON 10`) via `buzzerRows(mode)` so row 2 reads `Take
break` in quali and `End turn` in battle; a live `last: handset 2 · blue → Stop Player 2 (0:04
ago)` readout also logs inert presses as `→ locked: <reason>` and confirm-open presses as `→ closed
the … dialog`; the colour divergence is stated inline (`red → Start (green on screen)`). The
    **ADVANCE row is the one key whose effect the board decides**, so its readout quotes `advanceLabel`
    over the route the press dispatched (`→ STOP Player 1 · C. Bianchi`, a dead end
    `→ NOTHING TO ADVANCE — <reason>`) rather than the row's own binding label — the plate has moved on
    to promising the next press by the time the card is read.

## 5. Keyboard and buzzer map

| Input                               | Does                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Space**                           | ADVANCE (guarded per §4.3; the only global key)                                                                                                                                                                        |
| Click the TALLY plate               | ADVANCE (same dispatch; the plate never takes mouse focus)                                                                                                                                                             |
| Any ADVANCE while a confirm is open | the confirm's safe action (Keep timing / Keep match / Keep series); nothing dispatched; press again to advance                                                                                                         |
| Any other handset key, confirm open | nothing — the question owns the board; the readout reads `→ locked: answer the <question> first`                                                                                                                       |
| Enter (in a player's score form)    | Save that player (form submit; blocked while a field is over its max or Overall is NaN / over the bound)                                                                                                               |
| Tab / Shift+Tab                     | Difficulty → Combo → Style → Best trick → Control penalty → Overall → Save → DNF, Player 1 then Player 2                                                                                                               |
| Esc / Enter (in a confirm)          | the autoFocused safe action (Keep timing / Keep match / Keep series)                                                                                                                                                   |
| Handset 1 (pad 0–4) → Player 1      | red 0 Start · yellow 1 Reset (asks if the lane still holds a turn; locked while best trick is armed) · green 2 Take break (quali) / End turn (battle) · orange 3 try · blue 4 Stop                                     |
| Handset 2 (pad 5–9) → Player 2      | same five, +5                                                                                                                                                                                                          |
| Handset 3 red (pad 10)              | ADVANCE, identical to Space (including the confirm-open rule)                                                                                                                                                          |
| Any handset press                   | updates the `last pressed` readout, even when inert (`→ locked: …`); a key an interlock blocks is answered on the plate too (`alert` + the 1 s flash, in the lock's own words); first press after load reveals the pad |

No other single-key shortcuts: every remaining action is a ≥44 px target or a handset button.

## 6. Tokens, type, sizes

Ratios are WCAG 2.x relative-luminance contrast, computed from `tokens.ts` / `tokens.css` (`canvas`
#F5F7F8, `panel` #FFFFFF, `muted` #EDF1F2, `ink.hi` #333C4E, `ink.mid` #5B6776). Text <24 px needs
≥4.5:1, numerals/words ≥24 px and non-text strokes ≥3:1. `contrast.test.ts` pins every row.

**New tokens** (`tokens.ts` + `tokens.css` + parity test; own hex, no aliases):

| Token              | Hex       | Role                                                            | canvas | panel |
| ------------------ | --------- | --------------------------------------------------------------- | ------ | ----- |
| `race.runningText` | `#0B6B65` | running digits / RUNNING word on light (no `runningDim` exists) | 5.91   | 6.35  |
| `race.goText`      | `#1F7A40` | go-tier text on light (outlined Start label, `then:` in go)     | 4.99   | 5.36  |
| `race.setText`     | `#8F5E12` | set-tier text on light (BREAK / CHANGEOVER state words)         | 5.17   | 5.56  |

`stopDim` (#C2391F) already serves as stop's text tier (5.01 canvas / 5.39 panel) — no new token.
`goDim` (3.79) and `setDim` (3.65) stay **numeral-only** tiers (≥24 px, ≥3:1) — winner numerals,
the break numeral, the pause count-up — never for words.

**Every live-path pair, named:**

| Surface                                  | Fill / ground    | Foreground       | Ratio | Rule |
| ---------------------------------------- | ---------------- | ---------------- | ----- | ---- |
| Plate, verb STOP / END TRY; Stop button  | `stopDim`        | `ink.onBrand`    | 5.39  | 4.5  |
| Plate, verb START / START TRY / RESUME   | `go`             | `ink.hi`         | 4.76  | 4.5  |
| Plate, verb TAKE BREAK                   | `set`            | `ink.hi`         | 5.54  | 4.5  |
| Plate, no-op / awaiting                  | `panel`          | `ink.hi`         | 10+   | 4.5  |
| Start contained (ADVANCE target)         | `go`             | `ink.hi`         | 4.76  | 4.5  |
| Start outlined (not the target)          | `panel`          | `goText`         | 5.36  | 4.5  |
| Running digits (≥24) + RUNNING word      | `panel`          | `runningText`    | 6.35  | 4.5  |
| Break / pause numeral (≥24)              | `panel`          | `setDim`         | 3.92  | 3    |
| BREAK / CHANGEOVER / TURN TAKEN words    | `panel`          | `setText`        | 5.56  | 4.5  |
| Expired digits + FINISHED · TIME word    | `panel`          | `stopDim`        | 5.39  | 4.5  |
| Idle / held digits                       | `panel`          | `ink.hi`         | 12+   | 4.5  |
| Running frame stroke (wide)              | `panel`          | `running` (teal) | 2.7   | n/a  |
| Idle / held frame stroke (thin / dashed) | `panel`          | `ink.mid`        | 5.76  | 3    |
| Break frame stroke (wide)                | `panel`          | `setDim`         | 3.92  | 3    |
| Expired frame stroke (thin)              | `panel`          | `stopDim`        | 5.39  | 3    |
| Plate state stripe, running              | `panel` keyline  | `runningText`    | 6.35  | 3    |
| Plate state stripe, break / changeover   | `panel` keyline  | `setDim`         | 3.92  | 3    |
| Plate state stripe, finished             | `panel` keyline  | `stopDim`        | 5.39  | 3    |
| Plate state stripe, ready / held / idle  | `panel` keyline  | `ink.mid`        | 5.76  | 3    |
| `SAVED n` / `Recording` chips            | `go`             | `ink.hi`         | 4.76  | 4.5  |
| `NOT SAVED` / `WARM-UP OVER` chips       | `stopDim`        | `ink.onBrand`    | 5.39  | 4.5  |
| `Reconnecting…` chip                     | `set`            | `ink.hi`         | 5.54  | 4.5  |
| `Not recording (…)` / `FS ×2` chips      | `stopDim`        | `ink.onBrand`    | 5.39  | 4.5  |
| Outlined alarm control (DNF, FS Lane n)  | `panel`/`canvas` | `stopDim`        | 5.01  | 4.5  |
| Outlined `warning` chip (attempt cap)    | `canvas`         | `setText`        | 5.17  | 4.5  |
| Save contained; filled mode chip         | `brand.tealDark` | `ink.onBrand`    | 4.61  | 4.5  |
| Confirm safe answer (text button)        | `panel`          | `brand.tealDark` | 4.61  | 4.5  |
| Board-format chip (QUALI / BATTLE)       | `lineStrong`     | `ink.hi`         | 7.06  | 4.5  |
| Locked (disabled) control label          | `muted`          | `ink.mid`        | 5.06  | 4.5  |
| Chosen key, live and locked              | `lineStrong`     | `ink.hi`         | 7.06  | 4.5  |
| Locked outlined stroke vs the live one   | `ink.mid`        | `line`           | 4.58  | 3    |
| Why-lines, keycaps, sub-lines            | `panel`/`canvas` | `ink.mid`        | 5.36  | 4.5  |

The running frame is the one deliberate <3:1 stroke: at 14 px wide it is a luminance/shape signal
(DESIGN_SYSTEM §2), and the RUNNING word + `runningText` digits carry the state redundantly (WCAG 1.4.1
satisfied by the word, 1.4.11 by the redundancy — the test pins the word, not the stroke).

**Locked is a muted well, in every tone.** A control that is locked drops its state colour for
`muted` + `ink.mid` — that fill is what makes locked _look_ locked, since an outlined neutral Reset
paints `ink.mid` ink on an `ink.mid` stroke while it is live. Its own stroke goes recessive
(`line` on `muted` is 1.11:1, and WCAG 1.4.11 exempts inactive components from the 3:1 floor); what
the row above pins is the **step between the two strokes**, because that is the mark separating
locked from live at 25 % scale. The one thing a lock may not take is _which option is chosen_ — so
that mark is the **same in both states**: the chosen key of a segmented setting (the mode toggle,
the best-trick cap pair) is `ink.hi` over the darker `lineStrong` well, live and locked, a fill +
ink step inside the grey family. MUI's own selected mark is brand teal on a teal tint (2.72:1) and
its contained default the brand fill, both of which the row above rules out on the live path; the
pair has one owner, `chosenKey` in `tokens.ts`, because its consumers are a `MuiToggleButton`
override, an `sx` on a plain `Button`, and the header's board-format chip — that toggle's read-only
echo, which wears its mark rather than the brand.

**Brand teal has one live tier, `tealDark`, and only where a panel is the ground.** MUI hands
`primary.main` to three surfaces unasked — a contained fill, a filled chip's ground, a text button's
ink (a confirm's safe answer is a plain `<Button>`) — and all three measure 2.9:1. All three move to
`tealDark` in the theme, never at a call site. It clears 4.5:1 on `panel` (4.61) but **not** on the
canvas (4.29), which is why the format chip leaves the family instead of darkening inside it;
`contrast.test.ts` pins that ceiling so a later surface cannot spend the tier on the canvas, and
`brandFill.test.tsx` pins all three landing on it.

**Theme wiring:** `palette.success.contrastText` and `palette.warning.contrastText` become `ink.hi`
(today white — 2.3:1 / 2.0:1); `palette.error` stays as is, and the rule is that **no live-path
element paints `error.main` at all** — 3.59:1 as a fill under white, 3.34:1 as ink on the canvas.
Stop fills are `stopDim` via `RaceButton`/tokens (the test greps the control pages for
`color="error"` + `variant="contained"`); the alarm **chips** and the outlined alarm **buttons**
take the same tier from `MuiChip` / `MuiButton` alarm variants, so `color="error"` is correct by
default; and a `Typography` — the one place no theme rule reaches, since the tone is the whole
style — writes `color="error.dark"`, guarded by a second grep. `MuiButton
&.Mui-disabled` → `ink.mid` on `surface.muted`, with `borderColor: surface.line` on the `outlined`
slot; the same pair is wired onto the locked controls MUI would otherwise paint from
`action.disabled` / `text.disabled` — `MuiToggleButton` and a disabled outlined input's value,
label, why-line and notch. A rendered test (`test/app/theme/lockedControls.test.tsx`) pins that
they land on it, since MUI supplies a disabled look wherever the theme is silent; the alarm
variants are pinned the same way (`test/app/theme/alarmTones.test.tsx`), the locked pair included —
a lock outranks every tone.

| Decision                              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On-light digit tiers (`size=control`) | running `runningText` · break/pause `setDim` · expired `stopDim` · idle/held `ink.hi`                                                                                                                                                                                                                                                                                                                                                       |
| Frame tiers on the control variant    | §2 stroke tiers now also draw at `size=control`: thin `ink.mid` (idle); wide `running` sides; wide `setDim` sides (break); thin `stopDim` (expired); dashed `ink.mid` (held)                                                                                                                                                                                                                                                                |
| State word                            | Oswald/`label` style, 18–20 px, on the `*Text` tier of its state; always rendered                                                                                                                                                                                                                                                                                                                                                           |
| Plate                                 | verb 36–40 px Oswald caps + target name; fill per the table above; keycaps `ink.mid` on `panel`                                                                                                                                                                                                                                                                                                                                             |
| Plate state channel                   | 12 px stripe in the plate's own left padding, on a 2 px `panel` keyline — the fill follows the VERB, so the board's own state needs a channel a press cannot swing (running teal reads amber in quali, red in battle)                                                                                                                                                                                                                       |
| Live-column surfaces                  | every section holding a live clock is a `panel` Paper — both lane cards and the **armed** best-trick panel, which takes the run deck's own width ceiling so its box edge lands on the lanes it names; the ratios above are computed on `panel`, so a section left on the canvas is pinned against a ground it never paints. The disarmed best-trick step keeps §2's bare `[Begin best trick]` row — there is nothing yet for a card to hold |
| Race buttons                          | Start/Stop/Start try/End try ≥56 × 120; **every other live control ≥44** (Take break / End turn / Re-arm / Save / DNF / Retry / Reset); Reset neutral outlined `ink.mid`, behind a dashed divider — the offset + the confirm are its guard, not size                                                                                                                                                                                        |
| Button colour                         | Start = contained `go` only on the ADVANCE target, outlined `goText` otherwise; Stop = contained `stopDim` only while its lane runs; brand teal confined to links and nav                                                                                                                                                                                                                                                                   |
| Clock scales                          | lanes + try clock `control`; warm-up new `secondary` (~half); pause count-up 30–38 px setDim                                                                                                                                                                                                                                                                                                                                                |
| Numerals                              | JetBrains Mono `tabular-nums` everywhere a value ticks (§4 rule, unchanged)                                                                                                                                                                                                                                                                                                                                                                 |

## 7. Unchanged, and why

| Stays                                                                        | Why                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `battleMachine`, `bestTrickSeries`, `warmupChannel` transition tables        | the audit found no state defect; new reducer surface is `PEER_HINT`, `armedMs` on `LaneState`, and `SET_BUDGETS` gaining the effects `RESET` already has                                                                                          |
| The wire: `CountdownWSMessage`, `LiveSelection`                              | `lastRan` is derived (§4.11); `SET_BUDGETS` sends the existing `reset_countdown` — no new message type                                                                                                                                            |
| The `state_snapshot` shape — **one additive field** (iteration 3)            | `armedMs` on the countdown row: the room owns the armed budget (§4.6/B2). The PLANS "no snapshot change without an ADR" guardrail is satisfied by ADR 0046 §2, amended for it; a pre-feature sender omits it and degrades per the stated fallback |
| ADR 0037 §2/§3 cycles, ADR 0033 confirm, ADR 0038 peers + local-bound writes | untouched; the plate only renders the existing route                                                                                                                                                                                              |
| Quali advisory break, battle pause count-up (control-local, unrelayed)       | ADR 0036 §2/§3                                                                                                                                                                                                                                    |
| Numbered chronology 1–6                                                      | kept; laid out Z-shaped (1–2 left, 3–5 centre, 6 right) at ≥1280×800, tabs below                                                                                                                                                                  |
| Athlete pickers live during a run/changeover                                 | a name fix mid-changeover is a real need; only Round/Gender/Match stay 0033-guarded                                                                                                                                                               |
| Corrections on the Scores page, Save never confirmed                         | manual §6 — **upheld harder**: `New entry` goes (it was an upsert overwrite); a saved panel unlocks only on athlete change and links to the Scores page                                                                                           |
| The Speedline board                                                          | out of this batch; a P3 follow-up applies the RaceButton contract + header chips so there are not two dialects                                                                                                                                    |

## 8. Rubric (re-score every round against this)

Weighted mean over 18 criteria, each 0–10. Full measures live in the review record; the one-line
form is what a re-score needs.

| Id  | Criterion                                                                   | Wt  | Measure (short)                                                                                          |
| --- | --------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------- |
| C01 | One dominant state indicator per lane, colour = state                       | 5   | squint test per reducer state; −2 per text-only state; −2 per decorative state hue                       |
| C02 | Eyes-off ADVANCE: one gesture, one event, no double action                  | 5   | guard list, repeat, preventDefault, press token, explicit rows incl. no-ops, pinned tables               |
| C03 | Mode + next-press visibility (Raskin)                                       | 5   | states with a legible next-effect / all states; −2 mode only in Setup; −1 silent no-op states            |
| C04 | Confirm only the irreversible; safe default; no native dialogs              | 4   | −2 per class-(b) confirm; −2 per `window.confirm`; −2 destructive default focus                          |
| C05 | Target size + spacing (Fitts / WCAG 2.5.5)                                  | 5   | race controls ≥44 (target 56); Reset offset; −2 per undersized live control                              |
| C06 | Interlocks + explained lock-outs                                            | 4   | −2 per missing interlock; −1 per unexplained lock; manual lists the locks                                |
| C07 | Every press acknowledged locally ≤100 ms (visible + audible where eyes-off) | 5   | action × feedback table; −2 relay-dependent feedback; −2 silent no-op; −1 audio-lock not shown           |
| C08 | Persistent per-player save status separate from the clock                   | 4   | −3 failure only a toast; −2 values lost; −2 no retry                                                     |
| C09 | Connection state visible without occluding; clocks tick with socket down    | 4   | −2 badge over a control; −2 OPEN-no-peer ≡ OPEN-snapshot; −3 a clock stalls                              |
| C10 | Reload / rejoin recovers the view                                           | 5   | restored fields / total (pause count-up excepted); −2 idle-looking amnesia; −2 older-than-live           |
| C11 | Score entry bounded, typo-proof, keyboard-complete                          | 4   | caps shown; over-max blocks Save; tab order; Enter saves; override clear + bound; Space never advances   |
| C12 | Sunlight legibility: contrast, non-colour cues, tabular digits              | 4   | −2 per failing live-path pair; −2 per colour-only cue; −2 proportional ticking digits                    |
| C13 | Chronology enforced by layout; one primary action per state                 | 3   | one contained button per lane in a live state; current step visually current; quali renumbers            |
| C14 | Layout stability                                                            | 3   | −2 per control shifting ≥8 px between adjacent states                                                    |
| C15 | Consistent vocabulary + colour across lanes, screen, buzzer, manual         | 3   | mirror lanes; labels = manual; Start go / Stop red; handset↔screen divergence stated on the board        |
| C16 | Buzzer mapping verifiable live, generated from constants                    | 3   | −3 hand-maintained table; −2 no last-press readout; −1 no no-pad hint; −1 mode-blind                     |
| C17 | Peer-panel awareness                                                        | 2   | mirror within one round trip; a cue per peer-applied event; peer presence shown; no peer-triggered write |
| C18 | Audio cue design + readiness                                                | 4   | four discriminable tones; run-zero on both surfaces; dedupe across panels; AUDIO LOCKED shown            |

Anti-patterns the score punishes regardless of criterion: native confirms in the live path,
confirm-instead-of-lock, state hue as decoration, colour-only state, transient-only failure feedback,
relay-dependent feedback, silent no-ops, invisible mode, sub-44 px live targets, Reset flush beside
Stop, layout shift on state change, hand-retyped mapping tables, silent peer events, auto-transitions
on a timer edge, snapshot amnesia rendered as idle, live-board score editing, text <14 px on the live path.

## 9. Findings resolved

| Finding | Title (short)                                             | Resolved by (backlog id)                                                         |
| ------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| S01     | no mode / next-press statement                            | `fsux-tally-plate`                                                               |
| S02     | hue-only lane state; ran ≡ never-ran                      | `fsux-lane-card`                                                                 |
| S03     | live controls under 44 px; Reset flush beside Stop        | `fsux-lane-card`, `fsux-best-trick-panel`, `fsux-warmup-card`                    |
| S04     | live-path contrast failures                               | `fsux-race-tokens`, `fsux-lane-card`                                             |
| S05     | Space guard misses combobox/listbox/button                | `fsux-advance-guard`, `fsux-race-button`, `fsux-desk-layout` (SelectField)       |
| S06     | three "live" predicates; Set-both-lanes RESETs a held run | `fsux-set-budgets`, `fsux-board-predicates`                                      |
| S07     | failed save never rendered per player                     | `fsux-score-status`                                                              |
| S08     | Overall override unbounded, cannot clear                  | `fsux-score-entry-ergonomics`, `fsux-overall-bound-server`                       |
| S09     | lanes not locked during a try                             | `fsux-lane-interlocks`, `fsux-advance-route`                                     |
| S10     | clocks `display:none` while socket not OPEN               | `fsux-countdown-props-union`                                                     |
| S11     | Reset confirms only while running                         | `fsux-reset-guards`                                                              |
| S12     | no-op ADVANCE beeps like a real one                       | `fsux-advance-route`, `fsux-tally-plate`                                         |
| S13     | reload renders a confident idle board; silent mirroring   | `fsux-peer-state`                                                                |
| S14     | four expiries share one tone                              | `fsux-warmup-card` (the four-tone map + tests)                                   |
| S15     | `audioBlocked` dropped on control pages                   | `fsux-control-health-chips`                                                      |
| S16     | two native confirms                                       | `fsux-board-predicates`                                                          |
| S17     | score entry: no caps, no Enter, wheel-scrubbable          | `fsux-score-entry-ergonomics`                                                    |
| S18     | hand-typed, mode-blind buzzer table                       | `fsux-handset-card`                                                              |
| S19     | controls move under the hand                              | `fsux-lane-card`, `fsux-warmup-card`, `fsux-desk-layout`                         |
| S20     | inverted race-button colour contract                      | `fsux-lane-card`                                                                 |
| S21     | saved score unreadable (disabled fields)                  | `fsux-score-status`                                                              |
| S22     | toast over the clocks                                     | `fsux-control-health-chips`                                                      |
| S23     | disabled race controls never say why                      | `fsux-lane-interlocks`, `fsux-lane-card`                                         |
| S24     | peer mode flip misses the format budgets                  | `fsux-board-predicates` (`applyFormat`)                                          |
| S25     | vocabulary contradicts the manual                         | `fsux-lane-card`, `fsux-score-entry-ergonomics`, `fsux-manual-freestyle-judging` |
| S26     | Save ~700 px below the clocks                             | `fsux-desk-layout`                                                               |
| S27     | four clocks at one scale                                  | `fsux-warmup-card`                                                               |
| S28     | winner announced before any save                          | `fsux-score-status`                                                              |

## 10. Build order and verification

Seven rounds, each leaving a working board (the index is `status.md` §3; specs in `plans.md`):
**1** routing · guards · `SET_BUDGETS` · predicates · tokens + contrast test (no visual change except
dark text on success/warning chips) → **2** the `ControlPage` split (behaviour-preserving, so every
later slice is written in its final home) → **3** `RaceButton` · the plate · peer state · health chips ·
the `Countdown` props union → **4** lane card · warm-up card · best-trick panel → **5** the desk ·
the handset card → **6** the score rail (union, status, ergonomics, server bound) → **7** the manual
pass · the Speedline sibling (P3).

Unit: the pure modules (`advanceRoute`, `boardState`, `buzzerRows`, `tallyModel`, the reducer
effect tables incl. `SET_BUDGETS` and `PEER_HINT` rows, `contrast.test.ts`) are table tests. Page:
`ControlPage.test.tsx` addresses lane controls by accessible name (never `.at(-1)`) — a guard test
asserts no two buttons on either board share a name, and that every per-player row `buzzerRows`
prints names a button on the board (its §4.14 twin; both spellings come from `controlName.ts`), so
a rewrite that drops a per-player suffix or re-words a key fails there rather than in the test that
had to count buttons — and covers Space /
pad 10 / plate routing, the plate label per state, the guard regression trio (focused combobox, open
listbox, mouse-clicked button), the confirm-open trio (Space / pad 10 / plate → identical outcome),
"Set both lanes on an idle board sends two `reset_countdown`", and the disarm event. Realtime (owed
by the DoD after any console change, agent-runnable via the driver): `realtime-recovery`,
`freestyle-battle`, `display-signoff`, `peer-mirroring` — the last one specifically re-checks the
mirrored re-arm after `Set both lanes` and a mode flip, and (§4.10/§4.11, green 2026-09-10) the two
peer-state claims a fabricated message cannot prove: a peer's Start labels the lane it addressed and
only that one, and a panel **reloaded** mid-match still promises the alternating lane rather than the
`lastRan === null` lead. **`realtime-recovery` carries one added step
(iteration 3, B2, green 2026-09-08):** arm a room to a **non-default** budget, open a second control
panel, and Reset from that joiner — both panels and the preview re-arm to the room's budget, and the
joiner's mode toggle / `Set both lanes` stay unlocked (the lane reads pristine, not TURN TAKEN) the
moment the snapshot lands; `peer-mirroring` asserts the same Reset frame on its mid-run third panel,
and `ControlPage.test.tsx` pins the board half in both wire shapes (`armedMs` carried, and omitted by
a pre-feature sender). Human-only residue (physical handsets) routes to `human-tasks.md`, not here.
