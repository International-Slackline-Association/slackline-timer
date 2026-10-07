---
title: Running a competition
audience: Organiser
summary: Creating the competition, entering athletes, seeding the bracket, fixing results, and granting access.
order: 4
---

# Running a competition

Everything an organiser sets up before and between the runs: the competition
itself, the athlete list, the bracket, the results, and who is allowed to
operate it.

## Create the competition

**Competitions → New competition.**

| Field                | Notes                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Competition id**   | Letters, digits, `_` and `-` only. It appears in URLs and identifies the live timer session — pick it carefully, it is not meant to change. |
| **Name**             | The display name shown in the app and on the graphics                                                                                       |
| **Start / end date** | The event dates                                                                                                                             |

Creating a competition selects it, so you can go straight on to the athletes.

> Only ISA **timer admins** can create competitions. If you do not see the
> button, ask an ISA timer admin to create it and grant you access.

## Enter the athletes

**Athletes** (with the competition selected).

| Field                 | Notes                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **First / last name** | Kept separate because the broadcast cards set them in different weights. Leave the last name blank for a mononym. |
| **Short name**        | Optional. Used where an overlay is tight on space; otherwise the last name is used.                               |
| **Birth date**        | —                                                                                                                 |
| **Country**           | A 2- or 3-letter code (`DE`, `USA`, IOC `SUI`) or a 3-digit numeric code. Drives the flag on the graphics.        |
| **Second country**    | Optional, for dual representation; same codes as Country.                                                         |
| **Gender**            | Determines which field the athlete competes in.                                                                   |
| **Notes**             | Optional, internal.                                                                                               |

### Photos

Use **Upload photo** on the athlete form. JPG, PNG or WebP, up to 30 MB.
Photos are resized automatically before upload (to a JPEG of at most
1280 pixels on the long side), so a straight-from-the-camera picture is fine
and comes out the right way up.

The form shows a **live preview of the broadcast card** as you fill it in —
photo, name split and flag — so you can check how an athlete will look on air
without opening an overlay.

Photos are stored privately and delivered to the graphics through signed links
that expire with the event.

### Deleting an athlete

An athlete who already has recorded times or is placed in a match cannot be
deleted — the app tells you so in the confirmation dialog. Remove the results
first, or just leave the athlete in place.

## Seed and advance the bracket

**Matches** → the **Advance bracket** control, on the filter row beside the
gender it acts on. Choose the discipline (Speed / Freestyle) and gender first —
the bracket is per discipline and gender.

| Step                        | What it does                                                      |
| --------------------------- | ----------------------------------------------------------------- |
| **Qualification → Bracket** | Builds the entry round from the qualification ranking             |
| **Quarters → Semis**        | Moves the quarter-final winners into the semi-finals              |
| **Semis → Final**           | Moves the semi-final winners into the final (and the small final) |

For the first step you can also choose the **entry stage**:

- **Auto (field size)** — the default. Nine or more ranked athletes go into
  quarter-finals; fewer go straight to semi-finals.
- **Quarter-finals (top 8)** or **Semi-finals (top 4)** — force the entry stage
  when the field is being handled differently on the day.

Seeds are drawn so the top two qualifiers can only meet in the final:
quarter-finals pair **1v8, 4v5** (top half) and **2v7, 3v6** (bottom half);
semi-finals seeded directly pair **1v4, 2v3**.

If a step would overwrite matches that already exist, the app stops and asks you
to confirm before replacing them. That guard exists so a stray click cannot wipe
a bracket mid-event — read the dialog before confirming.

Matches can also be created and edited by hand on the same page.

## Fix results

Both consoles record results as they go, so the result pages are mostly for
**corrections**.

- **Times** — every recorded speed time. Filter by athlete, round and gender;
  ordered fastest first, DNFs last. This is where you correct a DNF, fix a time
  from an earlier run, or add a time the console failed to save.
- **Scores** — every freestyle judged score, one per athlete per round, ordered
  by overall. Same idea: correct or delete.

Every change is picked up by the other screens immediately — rankings and the
broadcast graphics update themselves.

## Rankings and standings

**Rankings** shows the ranked field for a round.

- **Speed** ranks by best time; a DNF sorts last and shows as _DNF_.
- **Freestyle** ranks by the judged overall, with the component breakdown.
- Athletes with no result for that round are left out.
- **Final standings** merges the bracket outcomes with qualification into the
  event's final order. Ranks still to be decided are dimmed. **Source** is the
  round that placed the athlete; when the shown result comes from another round
  it is noted in grey, e.g. _Final (result: Qualification)_.
- **Combined** averages an athlete's two overall placements across the
  disciplines. The discipline toggle is not used there.

### How positions are decided

**Ties within a round.**

- **Speed** — equal best times go to the faster **second-best** run of that
  round; an athlete with only one run loses that comparison. Then by name.
- **Freestyle** — equal overalls go to the higher **Difficulty**, then
  **Combo**, then **Style**, then **Best trick**. Then by name.

On the rankings and score-card overlays, athletes showing the same result share
a rank — `=1, =1, 3` — even when a tiebreak decided their order in the list.

**Final standings** are built the same way in both disciplines, from that
discipline's bracket and qualification:

| Places | Who                   | Order                                |
| ------ | --------------------- | ------------------------------------ |
| 1–2    | Final                 | Winner, then loser                   |
| 3–4    | Small final           | Winner, then loser                   |
| 5–8    | Quarter-final losers  | Their **qualification** rank         |
| 9+     | Rest of qualification | Qualification rank, numbering from 9 |

- Places 5–8 do not use the quarter-final result: a loser with the faster
  quarter time (or higher quarter score) can still place below another loser.
- With a semi-final bracket (top 4) there are no quarter losers, and the
  qualification tail numbers from 5.
- While a band is undecided (dimmed), its athletes are shown in qualification
  order. A seeded athlete with no qualification result goes last in their band.
- The result shown is the athlete's best in the round that placed them; with
  none there it falls back to qualification (grey), and with none at all it
  shows _—_.

**Combined** uses the two final-standings places, not the qualification ranks:
first in speed and fifth in freestyle averages 3.0.

- Only athletes placed in **both** disciplines appear — a one-discipline athlete
  is left out, not given a last place.
- Equal averages share a rank (`=2, =2, 4`); the athlete with the better single
  placement is listed first.

## Grant access to other operators

**Competitions → Managers** (on the competition), ISA timer admins only.

Add a manager by their **email address**; the app resolves it to their ISA
identity. They then sign in with their own ISA account and see only the
competitions they have been granted.

Revoking is immediate. If that operator has a console open, their connection is
refused within seconds and they are told why.

The distinction is simple:

- **ISA timer admin** — sees and operates every competition; can create
  competitions and manage managers.
- **Manager** — operates exactly the competitions granted to them.

## Before the event — a checklist

- [ ] Competition created, with the right id and dates
- [ ] Every athlete entered, with country and photo
- [ ] Managers granted to everyone who will operate a console
- [ ] Buzzer mapping checked on the actual machines
      ([Speed Highline](./speedline-timing.md#buzzer-buttons),
      [Freestyle Highline](./freestyle-judging.md#buzzer-buttons))
- [ ] Preview / venue screens open and showing the right competition
- [ ] Overlay links generated and loaded into OBS
      ([Broadcast overlays](./broadcast-overlays.md))
- [ ] A test round run end to end — the _Test_ round exists for exactly this
