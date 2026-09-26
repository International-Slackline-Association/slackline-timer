/**
 * The wrap model every authored operator line is held against. jsdom does no
 * layout, so a line the board reserves room for is checked against this rather
 * than measured: a string worded longer than its slot fails here instead of on
 * the desk, where the operator finds out by a control sliding out from under a
 * glove.
 *
 * Shared, because two surfaces now budget their own strings the same way — the
 * lane card's why-line (`WhyLine.test`) and the score rail's save status
 * (`FreestyleScoreControls.test`) — and a model kept twice is a model that
 * drifts.
 */

/** Mean glyph advance of the 14 px body face (~0.5em). */
export const GLYPH_PX = 7;

/** What a line of the given content width holds, at that face. */
export const charsPerLine = (contentPx: number): number => Math.floor(contentPx / GLYPH_PX);

/**
 * The slack every authored line owes its longest row. The content widths are
 * derived numbers — `LANE_CARD_CONTENT_PX` moved 241→246 with the
 * `LANE_COLUMN_PX` correction, silently loosening the lane budget from 34 to 35
 * chars — so a string wrapping at EXACTLY the budget is one desk nudge away
 * from taking an extra line, and a line-count assertion alone would go red only
 * after the fact. One glyph of headroom is what makes the next nudge fail in a
 * test instead of on the board.
 */
export const REQUIRED_SLACK_CHARS = 1;

/** A greedy wrap at one glyph = one advance, as the lines it takes. */
export const wrap = (text: string, chars: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const extended = line === '' ? word : `${line} ${word}`;
    if (line !== '' && extended.length > chars) {
      lines.push(line);
      line = word;
    } else {
      line = extended;
    }
  }
  lines.push(line);
  return lines;
};

export const wrappedLines = (text: string, chars: number): number => wrap(text, chars).length;

export const longestLine = (text: string, chars: number): number =>
  Math.max(...wrap(text, chars).map((line) => line.length));
