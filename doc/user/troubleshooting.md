---
title: Troubleshooting
audience: Everyone
summary: The things that go wrong at a live event, and what to do about each one.
order: 6
---

# Troubleshooting

Ordered roughly by how often they happen at an event. The rule underneath all of
them: **timing keeps working even when saving does not.** A failed save never
disturbs a running clock, and can always be fixed afterwards on the Times or
Scores page.

## A screen is stuck or out of date

Symptoms: the preview clock is frozen, a venue screen is still showing the
previous run — its finish time, or the pair before this one — or an overlay
disagrees with the console.

1. **Look at the corner badge**, and read which of the two stories it tells.
   _Reconnecting_ or _Signal lost — reconnecting_ means a link the screen once
   had went away: the app reconnects itself and shows _Reconnected_ when it is
   back, so give it a few seconds. _Connecting_ or _No signal — retrying_ means
   this screen has not reached the competition yet — it has lost nothing, and
   after a few seconds the thing to check is the screen's own link: the address,
   the overlay token, and that it names the competition you are running.
2. **Press Reset on the console** (once nothing is live). Every screen follows.
3. **Reload the stuck screen.** A page that joins picks up the current state
   automatically.

If the console itself looks wrong, reloading the console is safe too — it asks
for the current state on open, and a second operator's board (if any) answers.
Working alone, the console falls back to its own copy of the run, kept on this
computer: it comes back with the clocks where they were, the athletes and round
you had chosen, and the line **recovered this panel's last run** in the header.
So a reload during a run is survivable — the browser still warns you before it
throws a live run away, and the recovery is this computer's own memory, so it
only works in the same browser you were running on.

## Times or scores are not saving

A **Not saved** chip, a **NOT SAVED · _reason_** line on a Freestyle score
panel, or a warning strip saying the time was not saved.

- **The timing was not affected.** The clock ran correctly and the value on
  screen is right.
- **Read the reason** — it is what the server said — then send it again:
  **Retry save** on the Freestyle panel that failed (your numbers are kept
  exactly as typed, and a failed DNF retries as a DNF). The status stays on the
  panel until it succeeds, so there is no message to miss.
- If it will not go through, write the number down and enter it on the **Times**
  page (or **Scores** for freestyle) once the connection is back.
- If it keeps happening, check the machine's network. Everything else in the app
  will be struggling too.

In a freestyle battle the winner is only decided once **both** scores are
stored — a player still reading NOT SAVED decides nothing.

## The buzzers do nothing

1. **Press any buzzer button once** after opening the console. Browsers hide
   game controllers until a button is pressed — nothing works before that.
2. **Check the controller is selected.** The console has a controller picker;
   pick the buzzer dongle if more than one device is attached.
3. **Press each button and read the mapping back.** On the freestyle board the
   **Handsets** card names every press in its `last:` line, including a press
   that was locked out; on the speed console, open the **Buzzer buttons** chip.
   Which physical handset the browser calls "1" can differ between machines —
   if the mapping is wrong, that is what you are looking at.
4. **Re-plug the dongle**, then press a button again.

The consoles are fully usable from the screen alone, so a dead buzzer is never a
show-stopper.

## No sound — AUDIO LOCKED

Browsers refuse to play sound until someone interacts with the page, and a
console opened straight from the login redirect has not been clicked yet.

The screen says which one you are looking at: the Freestyle board's header
carries a red **AUDIO LOCKED — click anywhere** chip instead of _Audio armed_,
and the other pages show an **Audio muted — click to enable** badge.

**Click anywhere on the page once.** That unlocks the audio for the rest of the
session; until you do, the page is silent — start-light beeps and clock run-outs
alike.

This bites hardest on the **preview** and athlete-display screens, because
nobody touches them — after opening one on the projector machine, click it once
before the first run.

## "Not authorized" or "session expired"

Sessions last about an hour.

- If you were signed in and working: **sign in again** and carry on. Nothing
  saved is lost.
- If the message mentions the competition: your access to _that_ competition was
  removed, or you never had it. Use **Go to competitions** and pick one you can
  operate, or ask the organiser to grant you access.

## The competition list is empty

Your ISA login worked, but no competition has been granted to you. Ask the event
organiser to add you as a manager — see
[Running a competition](./running-a-competition.md#grant-access-to-other-operators).

## An overlay is blank or stuck

**Blank is often correct.** Overlays deliberately show nothing when there is
nothing to show, so they composite away between matches instead of leaving an
empty box on air.

Check, in order:

1. **Is there data yet?** A winner card is blank until the match is decided; a
   ranking is blank until someone has a result in that round.
2. **Is the link for the right round and gender?** A round-pinned link keeps
   showing its round. The _live_ variants follow the board — prefer those.
3. **Has the link been revoked?** Generating new links after a revoke means the
   old URLs are dead. Re-copy from the **Overlays** page.
4. **Refresh the browser source** in OBS.

## The wrong athlete got the time

- **During the run** — press **Swap** to put the athletes on the correct lanes
  _before_ the start. Swapping is locked while a run is live, because the
  clocks are fixed to the lanes; the line under the button says so while it is.
- **After the run** — **Void run** deletes what that run recorded, so you can
  redo it. For anything older, edit it on the **Times** page.

## The wrong athlete got the score

Freestyle keeps one score per athlete per round, so a score entered against the
wrong name is re-filed, not deleted:

- **On the board** — pick the right athlete for that panel. The status line
  keeps naming the athlete the score is stored under —
  **SAVED 26.00 · Jane Doe** — and a **Move score to …** button appears beside
  it. Press it and the same numbers move to the athlete now on the panel, which
  comes back locked on them; in a Battle the winner is re-derived from where the
  scores then stand. Leave it alone if you simply moved on to the next athlete.
- **Later** — edit or delete the row on the **Scores** page. The panel's own
  **Scores page** link opens it already filtered to the round and athlete it
  came from.

## A lane was stopped before the athlete finished

Press **Resume Lane n** under that lane's clock, straight away. The clock
continues from the original start — nothing is lost — and the time the mis-press
saved is deleted, so the next stop records the real one. The button sits under
every lane's clock and comes alive once that lane stops: it stays live while the
other lane is still running and for about ten seconds after the last stop; after
that it says _why: run has resolved — Void or re-run instead_, and **Void run**
(which clears both lanes) or a re-run is the way back. If a second operator's
board pressed Resume, the board that saved the time deletes it — there is
nothing to tidy up on the **Times** page.

## A bracket step overwrote something

Advancing a bracket asks before it replaces existing matches. If it was
confirmed by mistake, rebuild the affected round by hand on the **Matches**
page, or re-run the advance step once the source results are right.

## Two operators are fighting over the board

That is a supported setup, not a fault — both boards mirror each other on
purpose, so one can take over if the other's laptop dies. Just agree who is
driving; whoever presses the button is the one whose action is recorded.

## Still stuck

Note the competition, the round, the exact time, and what the screen said, then
raise it with the event's technical lead. The precise minute matters — the
system keeps a record of what happened when.
