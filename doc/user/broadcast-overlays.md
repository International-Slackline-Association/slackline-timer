---
title: Broadcast overlays
audience: Broadcast producer
summary: Getting the live graphics into OBS — overlay links, background modes, and what each overlay shows.
order: 5
---

# Broadcast overlays

The graphics are ordinary web pages. You add them to OBS Studio (or vMix, or
anything that takes a browser source), and they update themselves live off the
timer and the results — no operator sits on them during the show.

## Get your links

**Overlays** in the app, with the competition selected.

1. Press **Generate overlay links**. This mints a **read-only link set** for this
   competition that works until the event ends.
2. Set **Background** first (below) for your graphics pipeline.
3. Copy the **live overlays first** (VS live, SVO, timer), then copy any
   round-pinned links only when you intentionally need a fixed round.

The page mints a **Speed** set and a **Freestyle** set for the same competition.

Round/gender selection is only for round-pinned overlays. Live overlays follow
the control board selection and do not need per-round re-copying.

**Revoke all links** kills every outstanding link at once. Use it if a link
leaks; generate a fresh one afterwards.

> The links are read-only by design. Nothing behind them can change a result, so
> they are safe to paste into a production rig, a Companion button or a shared
> show doc — but they _do_ expose the event's live data, so treat them like any
> other production credential.

## Add one to OBS

1. **Sources → + → Browser**.
2. Paste the URL.
3. Set the size to your programme resolution — **1920 × 1080** for a normal HD
   show. Any other 16:9 size works too: the graphics are drawn against the
   1920 × 1080 frame and scale with the source, so a 1280 × 720 or 4K browser
   source keeps the same proportions and margins.
4. Leave _Shutdown source when not visible_ **off**, so the overlay stays
   connected and is already up to date when you cut to it.

That is all. The overlays have transparent backgrounds, so they composite
straight over your programme feed.

## Background modes

One knob adapts every overlay to your rig. It is set with the **Background**
choice on the Overlays page, and travels in the link.

| Mode                      | Use when                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Transparent** (default) | OBS Browser Source, vMix Web Browser, NDI — anything that carries alpha                                                                                      |
| **Chroma key (magenta)**  | Your chain cannot carry alpha: HDMI capture, an ATEM Mini-class switcher, a hardware keyer. The overlay is filled with magenta `#FF00FF` for you to key out. |
| **H2R**                   | A chain that flattens the overlay onto a coloured ground _before_ the keyer                                                                                  |

Magenta is the key colour because the graphics use green for winners and the GO
light, and the athlete flags carry every other primary — magenta is the one
colour that never appears in the content, so keying it can never punch a hole in
a name plate or a flag.

If your keyer only offers green or blue, those are available too — but only use
them if nothing green or blue is ever on screen.

## What each overlay shows

All of them are **blank when they have nothing to say**, so an overlay left up
between matches composites away to nothing rather than showing an empty box.

For active operation, keep to live-following overlays first; use pinned
rankings/bracket/standings overlays mainly between heats.

| Overlay                         | Shows                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Rankings**                    | The round's ranked field as name plates                                                                        |
| **Rankings (top-4 profiles)**   | The same data as photo cards for the top four                                                                  |
| **Final standings**             | The event's final order, each row tagged with the round its shown time/score came from                         |
| **Head-to-head (VS)**           | The two athletes of a match, for a fixed round                                                                 |
| **Head-to-head (VS, live)**     | The same card, but following the board through every round — **set this one up once and never touch it again** |
| **Match winner**                | The decided match's winner card                                                                                |
| **Rounds summary** (speed)      | The best-of-3 tally, one card per won run                                                                      |
| **SVO side 1 / side 2**         | A single-athlete card per lane, following whoever the board has selected                                       |
| **Bracket (photos / names)**    | The playoff tree, in a photo or a name-plate layout                                                            |
| **Score card** (freestyle)      | The judged table with the full component breakdown                                                             |
| **Athlete display** (freestyle) | Full-screen athlete card(s): one hero in quali, split screen in battle                                         |

There are also two **timer** pages — the speed race clock and the freestyle
countdown — for putting the running clock on air.

### Prefer the "live" variants

Several overlays come in a round-pinned and a **live** flavour. The live ones
follow the control board's current selection, so you load them into OBS once at
the start of the day and they stay right through quarters, semis and the final.
Round-pinned links are for when you deliberately want to show an earlier round.

## A workable OBS layout

- One scene per graphic, each with its browser source.
- Keep a small **live ops** scene group at the top (VS live, SVO, timer), so
  switching during a heat never depends on scrolling through long scene lists.
- The **VS (live)** and **SVO** sources loaded once and left alone.
- The **timer** page as a source in your main race scene.
- The bracket and rankings on their own scenes for between-match beds.

On phones/small tablets, use the Overlays page for quick copy/revoke only; do
full OBS scene building on desktop.

## If an overlay goes blank or stale

Overlays are deliberately silent when there is no data — an empty overlay is
usually correct, not broken. If you think one is genuinely stuck, see
[Troubleshooting](./troubleshooting.md#an-overlay-is-blank-or-stuck).
