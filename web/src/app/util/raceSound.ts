/**
 * The tone vocabulary every surface shares — one literal union behind the
 * reducers' `audio` effects, `useEffectDrain` and `useSignalAudio`'s element
 * map, so a machine can never queue a beep the hook has no file for.
 *
 * **Four expiries, four tones** (FREESTYLE_BOARD_UX §4.2, audit S14): a run
 * budget reaching zero is `long`, a quali break running out `alert2`, the
 * warm-up running out `alert`, a best-trick try window closing `short`. They
 * used to share `long`, so an eyes-off operator — and the room — could not tell
 * which of four clocks had just ended. The control board and the audience
 * surfaces play the SAME tone per channel (each off its own Countdown,
 * ADR 0015 §3), so the two never disagree.
 *
 * `alert` doubles as the "that press did nothing" cue (§4.2) and `short` as the
 * press acknowledgement — deliberately: both are answers to an action, and a
 * fifth and sixth tone would be past what an operator can tell apart.
 *
 * **The four files are separated by rhythm first, then pitch** — through a PA
 * in a tent, burst count survives where a pitch step does not:
 *
 * | tone     | length | bursts            | pitch   |
 * | -------- | ------ | ----------------- | ------- |
 * | `short`  | 0.5 s  | 1                 | 452 Hz  |
 * | `long`   | 1.0 s  | 1                 | 904 Hz  |
 * | `alert`  | 2.4 s  | 6 warbling @ 3 Hz | 1034 Hz |
 * | `alert2` | 0.5 s  | 2 taps            | 1034 Hz |
 *
 * `alert2` shipped as `alert` truncated — same recording, same warble, apart
 * only in where it stopped, so nothing named the cue until it ended (0.9 s,
 * within 100 ms of `long`). It was re-cut from that recording's own first burst
 * as the set's only double. **Re-cut any file and it has to land its own row of
 * this table** — the measurement is a decode, the judgement a listen at venue
 * volume, and jsdom can make neither.
 */
export type RaceSound = 'short' | 'long' | 'alert' | 'alert2';
