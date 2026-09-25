---
title: Getting started
audience: Everyone
summary: What the app does, how to sign in, and how to pick the competition you are working on.
order: 1
---

# Getting started

Slackline Timer runs the timing, judging and on-screen graphics for a highline
competition. Everything you need for one event lives in one place: the athlete
list, the race clock, the judged scores, the rankings and the broadcast
graphics.

It covers the two competition disciplines of an ISA highline event:

- **Speed Highline** — two athletes race side by side on parallel lines; the
  fastest crossing wins. The app's console for it is labelled **Speedline**.
- **Freestyle Highline** — athletes are scored by judges on the tricks they
  land inside a timed run. Its console is labelled **Freestyle**.

## Who does what

| You are…               | You mainly use                                 | Read                                                 |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| **Speed timekeeper**   | The Speedline console                          | [Speed Highline timing](./speedline-timing.md)       |
| **Freestyle judge**    | The Freestyle board                            | [Freestyle Highline judging](./freestyle-judging.md) |
| **Organiser**          | The admin pages (athletes, brackets, rankings) | [Running a competition](./running-a-competition.md)  |
| **Broadcast / stream** | The overlay links in OBS                       | [Broadcast overlays](./broadcast-overlays.md)        |

You do not need a different account for each role — the same ISA login gives you
whatever the organiser has granted you.

## Signing in

Open the app and choose **Sign in with ISA**. You are sent to the shared ISA
login page (the same one you use for other ISA tools) and returned to the app
afterwards. If you followed a deep link, you land back on that exact page.

You need:

- an **ISA account**, and
- **access to at least one competition** — either you are an ISA timer admin
  (you see every competition) or an organiser has added you as a manager on a
  specific competition.

If you sign in and see no competitions, ask the event organiser to grant you
access. Your login is fine; the access simply has not been given yet.

Sessions last about an hour. When one expires the app tells you plainly — sign
in again and carry on. Nothing you already saved is lost.

## Pick the competition first

Almost every screen works on **one selected competition**. Choose it on
**Competitions**; the name then shows in the top bar, and stays selected on that
device until you change it.

Until you select one, the athlete/times/scores/rankings pages just ask you to
pick a competition, and the two timer launch buttons stay greyed out.

## The two consoles

From the top bar you can launch either console. Both open in their **own browser
tab**, so starting one never tears down the other:

- **Speedline** — the Speed Highline race clock: two lanes, the 3-2-1 start
  light and the start beeps. See [Speed Highline timing](./speedline-timing.md).
- **Freestyle** — the Freestyle Highline judging board: warm-up clock, run
  countdowns, best trick, and score entry. See
  [Freestyle Highline judging](./freestyle-judging.md).

Each console has a matching **Preview** page — a clean, full-screen version with
no buttons, meant for a projector or a venue screen. Open the Preview from the
link on the console, drag it to the second screen and put it full-screen.

## Everything stays in sync

Every screen for the same competition is connected live. When the timer starts,
the preview, the venue screens and the broadcast graphics all start together —
they each run their own clock from the same agreed start moment, so nothing
drifts even on a slow venue network.

That also means:

- **A second operator can open the same console.** Both boards mirror each
  other, so a co-operator can take over instantly if a laptop dies. Whoever
  presses the button is the one who records the result.
- **A page that joins late catches up.** Open a preview mid-race and it picks up
  the running clock within a second or two.
- If a screen ever looks stuck, see
  [Troubleshooting](./troubleshooting.md#a-screen-is-stuck-or-out-of-date).

## A normal event day, end to end

1. **Before the event** — the organiser creates the competition, adds the
   athletes and their photos ([Running a competition](./running-a-competition.md)).
2. **Broadcast setup** — the producer copies the overlay links into OBS
   ([Broadcast overlays](./broadcast-overlays.md)).
3. **Qualification** — timekeepers time the qualification runs; times save as
   each lane stops.
4. **Seeding** — the organiser seeds the bracket from the qualification ranking.
5. **Finals** — the bracket is run match by match; winners advance.
6. **Standings** — the final standings page and the standings overlay are ready
   as soon as the last match is decided.

Freestyle Highline follows the same shape, with judged scores instead of times.
