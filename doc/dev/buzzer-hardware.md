---
last-updated: 2026-07-20
---

# Buzzer / gamepad hardware — button numbering

The physical operator input is a set of **Sony "Buzz!" buzzers** (the PS2/PS3
quiz-show controllers, also sold in a USB-wired PC variant). The web app never
speaks to them directly — it reads them through the browser **Gamepad API**
(`navigator.getGamepads()`), so any controller that presents standard buttons
works; the Buzz! is just the one the venue uses. The input plumbing is
documented in code (`app/hooks/useGamepads.tsx`,
`app/state/gamepadSelection.tsx`, `app/hooks/useAdvanceInput.ts`); this file is
the **hardware-side reference** — which physical button is which index — so the
mapping constants in the pages aren't magic numbers.

## What the browser sees

One Buzz! USB dongle enumerates as a **single gamepad** carrying **all four
handsets**. Each handset has 5 buttons — one big red buzzer plus four small
coloured buttons — so the device reports **20 buttons at indices 0–19**, four
contiguous blocks of five:

| Handset | Index block |
| ------- | ----------- |
| 1       | 0–4         |
| 2       | 5–9         |
| 3       | 10–14       |
| 4       | 15–19       |

Within each handset the five buttons are always in the same order
(`red, yellow, green, orange, blue` — confirmed against the raw HID byte-flag
map and the `buzz-buzzers` node driver):

| Offset | Colour           |
| ------ | ---------------- |
| +0     | **Red** (buzzer) |
| +1     | Yellow           |
| +2     | Green            |
| +3     | Orange           |
| +4     | Blue             |

So the full index → physical button table is:

| Index | Handset | Button | &nbsp; | Index | Handset | Button  |
| ----- | ------- | ------ | ------ | ----- | ------- | ------- |
| 0     | 1       | Red    |        | 10    | 3       | Red     |
| 1     | 1       | Yellow |        | 11    | 3       | Yellow  |
| 2     | 1       | Green  |        | 12    | 3       | Green   |
| 3     | 1       | Orange |        | 13    | 3       | Orange  |
| 4     | 1       | Blue   |        | 14    | 3       | Blue    |
| 5     | 2       | Red    |        | 15    | 4       | Red     |
| 6     | 2       | Yellow |        | 16    | 4       | Yellow  |
| 7     | 2       | Green  |        | 17    | 4       | Orange* |
| 8     | 2       | Orange |        | 18    | 4       | Green*  |
| 9     | 2       | Blue   |        | 19    | 4       | Blue    |

\* The raw HID bit order on handset 4 differs slightly between reference
dumps (green/orange swap); treat handset-4 colours 3/4 as **verify-on-site**.
`gamepad.id`, VID/PID, and the exact index that any given browser/OS assigns
also vary — Buzz! reports vendor `054c`, product `0002`, with an `id` string
like `"Sony Buzz"` / `"Logitech Buzz(tm) Controller V1"` depending on the
platform. **Confirm the live mapping with the on-screen gamepad tester before an
event** rather than trusting this table blind. The app persists the operator's
chosen pad by its `id` string (not the numeric index, which the browser reuses
across re-plugs — `gamepadSelection.tsx`).

## In-app reference

Each control page surfaces its own mapping to the operator: when a Buzz-type
controller connects (detected by `Gamepad.id`, `app/util/buzzer.ts`), a modal
auto-opens listing that page's button → action map with handset + colour, and a
"Buzzer buttons" chip reopens it (`app/components/BuzzerMappingDialog.tsx`). The
tables below are the source those pages pass in.

## How the app maps buttons to actions

> **Operator-facing view.** Which button an operator presses, and why, is the
> manual's job — [`user/speedline-timing.md`](../user/speedline-timing.md#buzzer-buttons)
> and [`user/freestyle-judging.md`](../user/freestyle-judging.md#buzzer-buttons).
> This section owns the **index → action** binding the code is written against;
> keep the two in step when a mapping moves.

Actions bind to the **numeric index**, so which physical button fires an action
is a consequence of the table above. Only handsets 1–3 are used today.

### Speedline (`app/pages/Speedline/ControlPage.tsx`)

| Index | Physical  | Action                  |
| ----- | --------- | ----------------------- |
| 0     | H1 Red    | Start (light sequence)  |
| 1     | H1 Yellow | Reset (confirm-guarded) |
| 5     | H2 Red    | Abort start             |
| 10    | H3 Red    | Stop lane 1             |
| 11    | H3 Yellow | False start, lane 1     |
| 15    | H4 Red    | Stop lane 2             |
| 16    | H4 Yellow | False start, lane 2     |

Lanes 1 and 2 each get **one buzzer** (H3, H4): its red stops that lane, its
yellow flags a false start on that lane. (Earlier the two false starts sat on a
single shared buzzer, H2 yellow/green — moved onto the per-lane buzzers so the
lane judge flags their own lane.)

### Freestyle (`app/pages/Freestyle/CountdownControl.tsx` + `BestTrickPanel.tsx`)

One pad drives both players: player 2's handler adds an offset of +5
(`indexAdjustment`), so player 1 uses handset 1 and player 2 uses handset 2.

| Logical | Action           | Athlete 1 (H1) | Athlete 2 (H2) |
| ------- | ---------------- | -------------- | -------------- |
| +0      | Start            | 0 (Red)        | 5 (Red)        |
| +4      | Stop             | 4 (Blue)       | 9 (Blue)       |
| +1      | Reset            | 1 (Yellow)     | 6 (Yellow)     |
| +2      | Break / end-turn | 2 (Green)      | 7 (Green)      |
| +3      | Start try        | 3 (Orange)     | 8 (Orange)     |

`TRY_BUTTON = { 1: 3, 2: 8 }` in `BestTrickPanel.tsx`.

### One-button ADVANCE (ADR 0037)

The Freestyle single-button flow (`app/hooks/useAdvanceInput.ts`) steps the
whole board via **keyboard Space _or_ pad button `ADVANCE_BUTTON = 10`** (H3
Red). Index 10 was chosen because indices 0–9 are all claimed above.

**Caveat (venue call, per ADR 0037).** Many standalone USB buzzers present as a
plain keyboard **Space** (works with the ADVANCE leg as-is) or as pad **button
0** — which on a Buzz! is handset-1 Red = Speedline Start, a collision that
needs the mapping re-homed once the real venue hardware is known. Physical-press
verification is the `gamepad-repeat-button-smoke*` items in
`@work/human-tasks.md`.

## Sources

- [Buzz Controllers on the Web — Jack Carey](https://jackcarey.co.uk/posts/buzz-controller-js/)
- [functino/buzz-buzzers (node.js Buzz driver)](https://github.com/functino/buzz-buzzers)
- [PS2 EU USB "The Buzz" controller — HID byte-flag map (gist)](https://gist.github.com/Lewiscowles1986/eef220dac6f0549e4702393a7b9351f6)
- [Using the Gamepad API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)
