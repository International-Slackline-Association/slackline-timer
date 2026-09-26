---
title: Freestyle handset reference
audience: Freestyle judge
summary: Handset button map, colour caveats, and pre-event verification for the Freestyle control board.
order: 8
---

# Freestyle handset reference

Use this page for setup/preflight and troubleshooting. During a live heat, use
`freestyle-judging.md` for the short operating flow.

## Handset mapping

One handset drives each athlete slot:

- Handset 1 -> Athlete 1
- Handset 2 -> Athlete 2

Both handsets use the same button order:

| Button | Does                                           |
| ------ | ---------------------------------------------- |
| Red    | Start                                          |
| Yellow | Reset                                          |
| Green  | **Take break** (quali) / **End turn** (battle) |
| Orange | **Start try** (best trick)                     |
| Blue   | Stop                                           |

Handset 3 red is **ADVANCE** (same as Space and state-plate click).

## Colour caveat

The handset colours are the hardware colours, not the board button colours.
Follow the action labels above and the on-screen **Handsets** card, not a
colour-to-colour match.

## Pre-event handset check

1. Open the Freestyle board on an idle competition.
2. In the **Handsets** card, confirm the empty-state hint appears.
3. Press one button on each handset so the browser reveals the controller.
4. Press each mapped key once and confirm the `last:` line names the expected
   action.
5. Confirm at least one lock case (`locked while ...`) so a locked key cannot be
   mistaken for a dead handset.

## Interpreting the `last:` line

Typical examples:

- `last: handset 2 · blue -> Stop Athlete 2 (0:04 ago)` -> action executed.
- `last: handset 1 · red -> locked while Athlete 1 runs` -> key is healthy, action is locked.
- `last: handset 3 · red -> STOP Athlete 1 · C. Bianchi` -> ADVANCE took that exact step.
- `last: handset 3 · red -> NOTHING TO ADVANCE - Begin best trick or Reset a lane` -> no-op with guidance.
- `last: handset 3 · red -> closed the Reset Athlete 1 dialog (Keep timing)` -> safe close while a question was open.
- `last: handset 2 · blue -> locked: answer the Reset Athlete 2 question first` -> another modal/question owns input.

Check bindings before the event starts: Start/Stop/End-turn keys on an idle
board can trigger real timer actions.
