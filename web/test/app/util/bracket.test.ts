import { describe, expect, it } from 'vitest';

import type { Match } from 'app/types';
import {
  BRACKET_SLOTS,
  type NameLabel,
  type NamePlate,
  nameTreeLayout,
  profileTreeLayout,
  resolveBracketSlots,
  resolveNameWinners,
} from 'app/util/bracket';

/**
 * The vertical band every painted element occupies, in canvas %: a box by its
 * rect, a label by its cap band (centre ± half its size) — the same reading
 * `SectionLabel` renders with.
 */
const verticalBands = (
  boxes: readonly NamePlate[],
  labels: readonly NameLabel[],
): readonly (readonly [number, number])[] => [
  ...boxes.map((b) => [b.topPct, b.topPct + b.heightPct] as const),
  ...labels.map((l) => [l.yPct - (l.sizePct * 100) / 2, l.yPct + (l.sizePct * 100) / 2] as const),
];

/** Assert the whole tree sits in the 5% title-safe band and centres on it. */
const expectTitleSafeAndCentred = (bands: readonly (readonly [number, number])[]) => {
  const top = Math.min(...bands.map(([t]) => t));
  const bottom = Math.max(...bands.map(([, b]) => b));
  expect(top).toBeGreaterThanOrEqual(5);
  expect(bottom).toBeLessThanOrEqual(95);
  expect((top + bottom) / 2).toBeCloseTo(50, 5);
};

const match = (over: Partial<Match>): Match => ({
  matchId: Math.random().toString(36).slice(2),
  compId: 'c1',
  discipline: 'speed',
  round: 'quarter',
  roundName: 'm',
  gender: 'male',
  position: 1,
  ...over,
});

describe('BRACKET_SLOTS', () => {
  it('defines all 16 playoff8 athlete slots', () => {
    expect(BRACKET_SLOTS).toHaveLength(16);
    expect(BRACKET_SLOTS.filter((s) => s.round === 'quarter')).toHaveLength(8);
    expect(BRACKET_SLOTS.filter((s) => s.round === 'half')).toHaveLength(4);
    expect(BRACKET_SLOTS.filter((s) => s.round === 'final')).toHaveLength(2);
    expect(BRACKET_SLOTS.filter((s) => s.round === 'small_final')).toHaveLength(2);
  });
});

describe('resolveBracketSlots', () => {
  it('binds quarter slots to athletes by position order and flags the winner', () => {
    const matches = [
      match({ round: 'quarter', position: 1, athlete1Id: 'a1', athlete2Id: 'a3', winnerId: 'a1' }),
    ];
    const resolved = resolveBracketSlots(matches);
    const a1 = resolved.find((s) => s.boxId === 'box_a_1')!;
    const a3 = resolved.find((s) => s.boxId === 'box_a_3')!;
    expect(a1.athleteId).toBe('a1');
    expect(a1.isWinner).toBe(true);
    expect(a3.athleteId).toBe('a3');
    expect(a3.isWinner).toBe(false);
  });

  it('leaves slots empty when no match feeds them', () => {
    const resolved = resolveBracketSlots([]);
    expect(resolved).toHaveLength(16);
    expect(resolved.every((s) => s.athleteId === undefined && !s.isWinner)).toBe(true);
  });

  it('degrades cleanly for a top-4 semi-final bracket (empty quarter round)', () => {
    // Small-field seeding (rules S7/F11) writes only half matches — the quarter
    // round is empty. The bracket must still bind the semi/final slots and leave
    // every quarter slot blank, so all three PlayoffBracket variants render.
    const matches = [
      match({ round: 'half', position: 1, athlete1Id: 's1', athlete2Id: 's4', winnerId: 's1' }),
      match({ round: 'half', position: 2, athlete1Id: 's2', athlete2Id: 's3' }),
    ];
    const resolved = resolveBracketSlots(matches);
    // Quarter slots stay empty (no feeding match).
    expect(
      resolved.filter((s) => s.round === 'quarter').every((s) => s.athleteId === undefined),
    ).toBe(true);
    // Semi slots bind to the seeded top 4.
    expect(resolved.find((s) => s.boxId === 'box_q_1_3')!.athleteId).toBe('s1');
    expect(resolved.find((s) => s.boxId === 'box_q_5_7')!.athleteId).toBe('s4');
    expect(resolved.find((s) => s.boxId === 'box_q_2_4')!.athleteId).toBe('s2');
    expect(resolved.find((s) => s.boxId === 'box_q_6_8')!.athleteId).toBe('s3');
    expect(resolved.find((s) => s.boxId === 'box_q_1_3')!.isWinner).toBe(true);
  });

  it('maps the final and small-final sides', () => {
    const matches = [
      match({ round: 'final', position: 1, athlete1Id: 'fa', athlete2Id: 'fb' }),
      match({ round: 'small_final', position: 1, athlete1Id: 'sa', athlete2Id: 'sb' }),
    ];
    const resolved = resolveBracketSlots(matches);
    expect(resolved.find((s) => s.boxId === 'box_final_l')!.athleteId).toBe('fa');
    expect(resolved.find((s) => s.boxId === 'box_final_r')!.athleteId).toBe('fb');
    expect(resolved.find((s) => s.boxId === 'box_sfinal_l')!.athleteId).toBe('sa');
    expect(resolved.find((s) => s.boxId === 'box_small_r')!.athleteId).toBe('sb');
  });
});

describe('resolveNameWinners', () => {
  it('reads the champion from the final and bronze from the small final', () => {
    const matches = [
      match({ round: 'final', position: 1, athlete1Id: 'fa', athlete2Id: 'fb', winnerId: 'fa' }),
      match({
        round: 'small_final',
        position: 1,
        athlete1Id: 'sa',
        athlete2Id: 'sb',
        winnerId: 'sb',
      }),
    ];
    expect(resolveNameWinners(matches)).toEqual({ winner: 'fa', small_winner: 'sb' });
  });

  it('returns undefined winners before either match is decided', () => {
    expect(resolveNameWinners([])).toEqual({ winner: undefined, small_winner: undefined });
  });
});

describe('nameTreeLayout', () => {
  const layout = nameTreeLayout();

  it('lays out all 18 plates incl. the two synthetic winner plates', () => {
    // 16 athlete slots (8 quarter + 4 semi + 2 final + 2 small_final) + winner
    // + small_winner — the art shows the FULL semi column, all four finalists.
    expect(layout.plates).toHaveLength(18);
    const ids = layout.plates.map((p) => p.boxId);
    for (const slot of BRACKET_SLOTS) expect(ids).toContain(slot.boxId);
    expect(ids).toContain('winner');
    expect(ids).toContain('small_winner');
  });

  it("sizes every plate as the art's uniform 390.54×49.92 bar", () => {
    // `LAAX 2026_Name Brackets.svg`: one bar size for every column, winner incl.
    for (const p of layout.plates) {
      expect(p.widthPct).toBeCloseTo((390.54 / 1920) * 100, 2);
      expect(p.heightPct).toBeCloseTo((49.92 / 1080) * 100, 2);
    }
  });

  it('keeps every plate in bounds and ordered left→right by round', () => {
    for (const p of layout.plates) {
      expect(p.leftPct).toBeGreaterThanOrEqual(0);
      expect(p.topPct).toBeGreaterThanOrEqual(0);
      expect(p.leftPct + p.widthPct).toBeLessThanOrEqual(100);
      expect(p.topPct + p.heightPct).toBeLessThanOrEqual(100);
    }
    const x = (id: string) => layout.plates.find((p) => p.boxId === id)!.leftPct;
    expect(x('box_a_1')).toBeLessThan(x('box_q_1_3'));
    expect(x('box_q_1_3')).toBeLessThan(x('box_final_l'));
    expect(x('box_final_l')).toBeLessThan(x('winner'));
  });

  it('sits inside the 5% title-safe band, vertically centred (bracket-tree-fit)', () => {
    // The art frame reserved an empty top quarter for an event logo that no
    // longer exists, so the tree hung bottom-heavy with 3RD PLACE in the bottom
    // 1.5%. One shared recentre lifts the whole tree — relative geometry
    // untouched — onto the canvas midline, inside the title-safe frame (§7.5).
    expectTitleSafeAndCentred(verticalBands(layout.plates, layout.labels));
  });

  it('moves the connectors with the recentred tree', () => {
    // The elbows are absolute canvas coordinates: a plate-only shift would
    // detach every join.
    const semi = layout.plates.find((p) => p.boxId === 'box_q_1_3')!;
    const [, endY] = layout.connectors[0][layout.connectors[0].length - 1];
    expect(endY).toBeCloseTo(semi.topPct + semi.heightPct / 2, 5);
  });

  it('centers each plate on the pair that feeds it', () => {
    const centerY = (id: string) => {
      const p = layout.plates.find((pl) => pl.boxId === id)!;
      return p.topPct + p.heightPct / 2;
    };
    expect(centerY('box_q_1_3')).toBeCloseTo((centerY('box_a_1') + centerY('box_a_3')) / 2, 5);
    expect(centerY('box_q_6_8')).toBeCloseTo((centerY('box_a_6') + centerY('box_a_8')) / 2, 5);
    expect(centerY('box_final_l')).toBeCloseTo(
      (centerY('box_q_1_3') + centerY('box_q_5_7')) / 2,
      5,
    );
    expect(centerY('winner')).toBeCloseTo((centerY('box_final_l') + centerY('box_final_r')) / 2, 5);
    expect(centerY('small_winner')).toBeCloseTo(
      (centerY('box_sfinal_l') + centerY('box_small_r')) / 2,
      5,
    );
  });

  it('labels the six sections at the art sizes with FINALS the largest', () => {
    const texts = layout.labels.map((l) => l.text);
    expect(texts).toEqual([
      'QUARTER FINALS',
      'SEMI FINALS',
      'FINALS',
      'WINNER',
      'SMALL FINAL',
      '3RD PLACE',
    ]);
    const finals = layout.labels.find((l) => l.text === 'FINALS')!;
    expect(layout.labels.every((l) => l === finals || l.sizePct <= finals.sizePct)).toBe(true);
    // Art font sizes over the 1080 frame: FINALS 129.96px, QUARTER FINALS 39px.
    expect(finals.sizePct).toBeCloseTo(129.96 / 1080, 4);
    const quarter = layout.labels.find((l) => l.text === 'QUARTER FINALS')!;
    expect(quarter.rotate).toBe(-90);
    expect(quarter.sizePct).toBeCloseTo(39 / 1080, 4);
  });

  it('draws a connector elbow for each join', () => {
    // 4 quarter→semi + 2 semi-pair→final + 1 final→winner + 1 small-final→bronze
    expect(layout.connectors).toHaveLength(8);
    expect(layout.connectors.every((c) => c.length >= 2)).toBe(true);
  });

  it('captions the bronze plate 3RD PLACE, mirroring the WINNER caption', () => {
    // The small-final winner's advancement bar floated unexplained while the
    // champion's said WINNER — same column, same size, same offset below the plate.
    const winner = layout.labels.find((l) => l.text === 'WINNER')!;
    const third = layout.labels.find((l) => l.text === '3RD PLACE')!;
    expect(third.xPct).toBeCloseTo(winner.xPct, 5);
    expect(third.sizePct).toBeCloseTo(winner.sizePct, 5);
    const centerY = (id: string) => {
      const p = layout.plates.find((pl) => pl.boxId === id)!;
      return p.topPct + p.heightPct / 2;
    };
    expect(third.yPct - centerY('small_winner')).toBeCloseTo(winner.yPct - centerY('winner'), 5);
    // ...and the caption band stays on the canvas.
    expect(third.yPct + (third.sizePct * 100) / 2).toBeLessThanOrEqual(100);
  });
});

describe('profileTreeLayout', () => {
  const layout = profileTreeLayout();
  const box = (id: string) => layout.boxes.find((b) => b.boxId === id)!;

  it('lays out 17 photo boxes incl. the center finals box', () => {
    // 14 athlete slots (8 quarter + 4 semi + 2 final) + center winner box
    expect(layout.boxes).toHaveLength(17);
    const ids = layout.boxes.map((b) => b.boxId);
    for (const slot of BRACKET_SLOTS) expect(ids).toContain(slot.boxId);
    expect(ids).toContain('winner');
    const finals = layout.boxes.filter((b) => b.isFinal);
    expect(finals).toHaveLength(1);
    expect(finals[0].boxId).toBe('winner');
  });

  it('mirrors the tree: left quarters far-left, right quarters far-right, finals center', () => {
    const x = (id: string) => {
      const b = box(id);
      return b.leftPct + b.widthPct / 2;
    };
    // Left side feeds inward (quarter < semi < pre-final < center)
    expect(x('box_a_1')).toBeLessThan(x('box_q_1_3'));
    expect(x('box_q_1_3')).toBeLessThan(x('box_final_l'));
    expect(x('box_final_l')).toBeLessThan(x('winner'));
    // Right side is the exact mirror of the left
    expect(x('box_a_2')).toBeCloseTo(100 - x('box_a_1'), 5);
    expect(x('box_q_2_4')).toBeCloseTo(100 - x('box_q_1_3'), 5);
    expect(x('box_final_r')).toBeCloseTo(100 - x('box_final_l'), 5);
    // Center is centered
    expect(x('winner')).toBeCloseTo(50, 1);
  });

  it('sits inside the 5% title-safe band, vertically centred (bracket-tree-fit)', () => {
    expectTitleSafeAndCentred(verticalBands(layout.boxes, layout.labels));
  });

  it('moves the connectors with the recentred tree', () => {
    const finalist = box('box_final_l');
    // The horizontal stub that runs from the semi pair's elbow into the
    // finalist box's left edge — it must still land on the box's mid-height.
    const stub = layout.connectors.find(
      (run) =>
        run.length === 2 &&
        run[0][1] === run[1][1] &&
        Math.abs(run[1][0] - finalist.leftPct) < 1e-9,
    )!;
    expect(stub[0][1]).toBeCloseTo(finalist.topPct + finalist.heightPct / 2, 5);
  });

  it("sizes each round's boxes to the art's escalating portrait rects", () => {
    // `LAAX 2026_Profile Brackets.svg` (1920×1080): every box is a 0.6-aspect
    // portrait rect, growing round by round toward the centre FINALS box.
    const artSize = (id: string, w: number, h: number) => {
      expect(box(id).widthPct).toBeCloseTo((w / 1920) * 100, 2);
      expect(box(id).heightPct).toBeCloseTo((h / 1080) * 100, 2);
    };
    artSize('box_a_1', 102.62, 171.03);
    artSize('box_a_8', 102.62, 171.03);
    artSize('box_q_1_3', 125.98, 209.97);
    artSize('box_final_l', 157.61, 262.68);
    artSize('winner', 216.44, 360.73);
    artSize('box_sfinal_l', 117.03, 195.05);
    // Escalation: quarter < small final < semi < finalist < centre FINALS.
    const w = (id: string) => box(id).widthPct;
    expect(w('box_a_1')).toBeLessThan(w('box_sfinal_l'));
    expect(w('box_sfinal_l')).toBeLessThan(w('box_q_1_3'));
    expect(w('box_q_1_3')).toBeLessThan(w('box_final_l'));
    expect(w('box_final_l')).toBeLessThan(w('winner'));
  });

  it('keeps every box in bounds', () => {
    for (const b of layout.boxes) {
      expect(b.leftPct).toBeGreaterThanOrEqual(0);
      expect(b.topPct).toBeGreaterThanOrEqual(0);
      expect(b.leftPct + b.widthPct).toBeLessThanOrEqual(100);
      expect(b.topPct + b.heightPct).toBeLessThanOrEqual(100);
    }
  });

  it('never lets boxes in the same column overlap vertically', () => {
    // Group boxes by their column (left edge); within a column, sorted top→
    // bottom, each box must end at or above the next one's top.
    const byColumn = new Map<number, (typeof layout.boxes)[number][]>();
    for (const b of layout.boxes) {
      const col = Math.round(b.leftPct * 10) / 10;
      const list = byColumn.get(col) ?? [];
      list.push(b);
      byColumn.set(col, list);
    }
    for (const column of byColumn.values()) {
      const sorted = [...column].sort((a, b) => a.topPct - b.topPct);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const next = sorted[i];
        expect(prev.topPct + prev.heightPct).toBeLessThanOrEqual(next.topPct);
      }
    }
  });

  it('labels both sides quarter+semi, a center FINALS (largest) and SMALL FINAL', () => {
    const texts = layout.labels.map((l) => l.text);
    expect(texts.filter((t) => t === 'QUARTER FINALS')).toHaveLength(2);
    // The art stacks SEMI FINALS on two lines.
    expect(texts.filter((t) => t === 'SEMI\nFINALS')).toHaveLength(2);
    expect(texts).toContain('FINALS');
    expect(texts).toContain('SMALL FINAL');
    const finals = layout.labels.find((l) => l.text === 'FINALS')!;
    expect(layout.labels.every((l) => l === finals || l.sizePct <= finals.sizePct)).toBe(true);
    // Art font sizes over the 1080 frame: FINALS 85.06px, QUARTER FINALS 34.79px.
    expect(finals.sizePct).toBeCloseTo(85.06 / 1080, 4);
    const qLabels = layout.labels.filter((l) => l.text === 'QUARTER FINALS');
    for (const q of qLabels) expect(q.sizePct).toBeCloseTo(34.79 / 1080, 4);
    // Quarter labels are rotated sideways on both edges (one each way).
    expect(qLabels.map((l) => l.rotate).sort()).toEqual([-90, 90]);
  });

  it('keeps the FINALS label band between the finals box and the small-final pair', () => {
    // The FINALS label sits under the centre box; its rendered cap band is
    // ~sizePct of canvas height. If it dips into the SMALL FINALS box pair the
    // athlete cards (painted last in the DOM) clip it.
    const finals = layout.labels.find((l) => l.text === 'FINALS')!;
    const centerBox = box('winner');
    expect(finals.yPct - (finals.sizePct * 100) / 2).toBeGreaterThanOrEqual(
      centerBox.topPct + centerBox.heightPct,
    );
    const bandBot = finals.yPct + (finals.sizePct * 100) / 2;
    for (const id of ['box_sfinal_l', 'box_small_r']) {
      expect(bandBot).toBeLessThanOrEqual(box(id).topPct);
    }
  });

  it('sets the SMALL FINAL label centered below the pair, on the canvas', () => {
    // The art wedged a two-line caption into the pair's 94.94px gap; Oswald
    // runs wider than the art's Placard Next, so it collided with (or scaled
    // illegibly between) the card frames. The label now sits under the pair —
    // the one region the tree keeps clear — with no width cap needed.
    const label = layout.labels.find((l) => l.text === 'SMALL FINAL')!;
    expect(label.xPct).toBeCloseTo(50, 5);
    const left = box('box_sfinal_l');
    const bandHalf = (label.sizePct * 100) / 2;
    expect(label.yPct - bandHalf).toBeGreaterThanOrEqual(left.topPct + left.heightPct);
    expect(label.yPct + bandHalf).toBeLessThanOrEqual(100);
  });

  it('draws the 17 art connector runs, all in bounds', () => {
    // Per side: 2 quarter-pair C-elbows + 2 stubs into the semis, 1 semi-pair
    // C-elbow + 1 stub into the finalist, 1 semi→small-final run (7 × 2), plus
    // the finalist cross-line, the stub up into the FINALS box, and the
    // small-pair join.
    expect(layout.connectors).toHaveLength(17);
    for (const run of layout.connectors) {
      expect(run.length).toBeGreaterThanOrEqual(2);
      for (const [x, y] of run) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
    }
  });
});
