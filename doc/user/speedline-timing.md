---
title: Speed Highline timing
audience: Speed timekeeper
summary: Running the two-lane race clock — start light, stopping lanes, false starts, and recording times.
order: 2
---

# Speed Highline timing

The **Speedline** console times **Speed Highline**: two athletes racing side by
side on parallel lines. It drives the start light and the start beeps, times
both lanes, and — if you tell it who is racing — saves each athlete's time the
moment their lane stops.

Launch it from **Speedline** in the top bar. It opens in its own tab.

> **Lines and lanes.** The athletes cross two parallel **lines**. The app calls
> each one a **lane** — Lane 1 and Lane 2 — because a lane is a stopwatch with an
> athlete assigned to it. Lane 1 is whichever line you decide it is; keep it the
> same all day so the operators and the broadcast agree.

## The board

Under the **status header** — competition name, round and gender, and the
connection and audio chips — the console lays out in three columns:

| Column                       | What is in it                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Left — setup**             | The **Preview** switch and the link that opens the projector screen, and the **Handsets** card (see [Buzzer buttons](#buzzer-buttons))                                                                                                                                                           |
| **Centre — the race**        | **Lane 1**, the start strip, **Lane 2**. Each lane holds its clock, its **Stop**, who is on it, its false-start control, its DNF and the chip that says whether its time was saved. The strip between them holds the start light, **Start**, **Abort start** and, below a dashed line, **Reset** |
| **Right — what is recorded** | Round, gender and match, **Swap**, the best-of-3 score, the false-start advice and **Void run**                                                                                                                                                                                                  |

On a narrow screen the three columns stack in that order — setup, then the race,
then what is recorded — so the clocks and their stop buttons still come first.
Setup collapses to a **single strip** across the top rather than a column: the
**Preview** switch and its link, whether a handset is connected, the line saying
what the last press did, and **Open handset map** — the same controls, on one
line, so the clocks and the stop buttons stay on screen without scrolling.

## Before the first run

1. **Turn the preview on** if a projector or venue screen is showing the race
   clock. The switch is at the top of the left column — in the setup strip on a
   narrow screen — and reads **Preview ON** or **Preview OFF**; the **Preview**
   link beside it opens the screen itself.
2. **Connect the buzzers** (if you use them) and press any button once so the
   browser sees the controller. See [Buzzer buttons](#buzzer-buttons).
3. **Click the page once if it says AUDIO LOCKED.** A browser opened straight
   from the login screen blocks sound until it is clicked, and the start beeps
   are the athletes' signal. The chip then reads _Audio armed_. The first chip in
   that row reads _Connecting…_ while the page reaches the relay, then
   _Connected_ — or _Reconnecting…_ / _Connection lost_ once a link it had goes
   down, and _Not connected_ if it never arrives. The clocks keep running
   through all of it; only the audience screens stop receiving — the line under
   the chips says so on every reading but _Connecting…_, and stays there, empty,
   the rest of the time so the row never shifts.
4. **Pick the round and gender** in the right-hand column.

## Timing a run

1. **Choose who is racing.** Either pick a **Match** in the right-hand column —
   that fills both lanes automatically — or set _Lane 1 athlete_ and _Lane 2
   athlete_ in the lane columns themselves. If the athletes are on the wrong
   sides, press **Swap**.
2. **Press Start.** The light sequence runs and the beeps sound; the clocks
   start on GO, together on every screen.
3. **Stop each lane as its athlete finishes** — the lane's stop button, or that
   lane's red buzzer. Each lane stops independently.
4. **The time saves itself.** A green **Saved 1:23.45** chip appears in that
   lane's column. That is your confirmation the result is stored.

### If nobody is selected on a lane

Nothing is recorded for that lane — the clock is purely visual. That is the
right setup for training and warm-up runs: leave both lanes on
_— not recording —_.

### Solo runs

If only one lane has an athlete, only that lane's clock starts. The other stays
dark. This is normal in qualification.

## Aborting and resetting

- **Abort start** — use this when someone jumps _during the light sequence_. It
  stops the sequence before GO, sounds the alert, and shows **START ABORTED** on
  every screen. Then press **Reset** to re-arm.
- **Reset** — clears both clocks and the display. While a run is live the app
  asks you to confirm first, so a stray press cannot wipe a running race.

A false start **after** GO does _not_ stop the run — see below.

### A dead button says why

Every race control prints its blocker right under it — **Swap** in the
right-hand column included, so you never have to
guess: _why: locked while the start sequence runs_, _why: locked while a lane
runs_, _why: no start sequence to abort_, _why: Lane 2 is not running_,
_why: Lane 1 is not stopped_. The two worth knowing before the event both mean
"the lights have finished, press **Reset**": _why: start aborted — Reset to
re-arm_ after an abort, and _why: sequence finished — Reset to re-arm_ after a
clean run. Either way the board looks idle but **Start** stays
dead until you press **Reset**. A lane's **Stop** is never taken away by the
link — it is your own clock, so it works even while the header says
_Reconnecting…_.

**While the reset question is on screen it owns the board**, buzzers included: a
stray handset press behind it does nothing at all. Answer it — **Keep timing**
or **Reset run** — and the buzzers work again.

## False starts

Under the competition rules a false start never halts a live run: the run
finishes, and the outcome is decided afterwards. So the console keeps the two
things separate.

**Flag it** with that lane's yellow buzzer, or with **False start · Lane 1** /
**False start · Lane 2** in that lane's column. An **FS ×1** chip appears on the
lane. Tapped it by mistake? Click the chip's ✕
to clear it.

With a **match selected**, the console then tells you what the rules advise, and
gives you the one button that carries it out:

| Situation                           | Advice shown                            | Button               |
| ----------------------------------- | --------------------------------------- | -------------------- |
| Both lanes false-started            | Void the run and rerun                  | **Void run & rerun** |
| The offending lane won              | A start rerun is advised                | **Void run & rerun** |
| Second false start by the same lane | That lane forfeits the round            | **Award round to …** |
| The clean lane won                  | Result stands — nothing to do           | —                    |
| Run still going                     | The run continues; video review decides | —                    |

The advice is exactly that — advice. The head judge decides; the button is there
so the decision is one tap, not a manual data fix.

A second false start on the same lane means the attempt fails and **no time is
recorded** for it.

## Recording and correcting results

- **Saved / Saving… / Not saved.** The chip under each lane is the truth. A
  _Not saved_ chip means the result did not reach the server — the timing itself
  was unaffected, so re-enter the time on the **Times** page.
- **Correct a time on the spot.** Once a lane's time is saved, a
  **Correct time** box appears next to it. Type the hand-timed value as
  `M:SS.hh` and press Enter. Useful when the hand timer and the system clock
  disagree.
- **The wrong athlete was on the lane.** Change the lane's athlete as usual.
  The chip keeps naming the athlete the time is stored under —
  **Saved 1:23.45 · Jane Doe** — and a **Move time to …** button appears beside
  it. Press it and the same time is re-filed under the athlete now on the lane;
  nothing is deleted and the clock value does not change. Leave it alone if the
  change of athlete was only a look-ahead.
- **Stopped a lane too early?** A **Resume Lane n** button sits under each
  lane's clock and comes alive the moment that lane stops. Press it and the
  clock carries straight on from the same start — no time is lost — and the
  time it just saved is deleted, so the athlete's real finish is the one that
  counts. Only that lane moves; the other one is untouched. It is on screen
  only: no buzzer button can un-stop a lane. It stays live while the other lane
  is still running, and for about ten seconds after the last lane stops; once
  the run is over it greys out and says _why: run has resolved — Void or re-run
  instead_.
- **DNF.** Press **Lane n DNF** to record a did-not-finish for that lane's
  athlete. DNF stops that lane's clock; press it whether or not you have
  already stopped the lane — one press, one record. If the lane had already
  saved a time, that same entry is changed to DNF rather than a second one
  being added, so the attempt still counts once.
- **Void run.** Deletes the times this run just recorded — the clean undo for a
  run that should not have counted. It asks first and names each time it would
  delete; **Keep times** leaves everything as it is.
- Corrections to a **DNF**, or to anything from an earlier run, are made on the
  **Times** page.

## Qualification attempts

In qualification each athlete gets two attempts. The lane shows an
**n/2 attempts** badge, and locks once the cap is used. If an attempt needs to
be given back, delete the extra time on the **Times** page.

## Best-of-3 matches

With a match selected, a **Best of 3** score line appears between the lanes and
counts the runs each athlete has won. It also drives the rounds-summary
graphic on the broadcast. **Reset series** clears the tally if you need to start
the match over; with runs already won it asks before wiping them (**Keep
series** leaves the score alone), and at 0–0 it simply applies. The recorded
times are kept either way.

Once both athletes have finished, the match winner is set automatically.

## Buzzer buttons

The console works entirely from the on-screen buttons — the buzzers are an
optional convenience, so the lane judges can stop their own lane.

The venue uses Sony "Buzz!" quiz buzzers: one dongle carries four handsets, each
with one big **red** button and four small coloured ones. The app assigns them
like this:

| Handset         | Button | Does                     |
| --------------- | ------ | ------------------------ |
| **1** (starter) | Red    | Start the light sequence |
| **1**           | Yellow | Reset                    |
| **2**           | Red    | Abort start              |
| **3** (lane 1)  | Red    | Stop lane 1              |
| **3**           | Yellow | False start, lane 1      |
| **4** (lane 2)  | Red    | Stop lane 2              |
| **4**           | Yellow | False start, lane 2      |

Two things to know:

- **The app must see the controller first.** Browsers only reveal a gamepad
  after a button is pressed. Press any buzzer button once after opening the
  console.
- **Check the mapping before the event.** Which physical handset the browser
  calls "1" can vary by machine. The **Handsets** card in the left column — the
  setup strip on a narrow screen — names the last button you pressed and what it
  did; press each one and read the line. **Open handset map** beside it shows
  the full table; it only
  opens when you ask for it, and while it is open the buzzers wait, the same way
  they do behind the reset question.
- **The colours do not match the screen.** The sheet says so — _red → Start
  (green on screen)_ — because the handset's big red key is the console's green
  **Start**.

Not seeing the buzzers at all? See
[Troubleshooting](./troubleshooting.md#the-buzzers-do-nothing).
