import { SCHEDULE_LABEL_MAX_LENGTH } from "@/lib/services/schedule";

/**
 * The most text (in code points) the label field takes in: four times the limit of the label. The limit of the label
 * itself counts after the whitespace is collapsed (`validateScheduleInput`), so the field cannot stop at that limit while
 * the planner types: it would cut a label that is valid. This cap only keeps a huge paste out of the page.
 */
export const LABEL_INPUT_MAX_LENGTH = SCHEDULE_LABEL_MAX_LENGTH * 4;

// The first `count` code points of `text` (fewer when it has fewer). A code point takes at most two UTF-16 units, so the
// slice is long enough to hold all of them, and it keeps the work small however long `text` is.
function firstCodePoints(text: string, count: number): string[] {
  return Array.from(text.slice(0, count * 2)).slice(0, count);
}

/**
 * The text the label field keeps for what was typed or pasted. Up to `LABEL_INPUT_MAX_LENGTH` code points it is the text
 * itself, with every space, so a label with double spaces can be typed and the server's rule (collapse, then count)
 * decides. Past the cap the whitespace is collapsed the way the server does it, and only what still does not fit is cut:
 * a paste padded with blanks keeps its words, and a paste that is really too long ends up over the label limit, so
 * validation answers with the label error instead of the text being shortened to a valid one.
 */
export function capLabelInput(value: string): string {
  if (firstCodePoints(value, LABEL_INPUT_MAX_LENGTH + 1).length <= LABEL_INPUT_MAX_LENGTH) {
    return value;
  }
  return firstCodePoints(value.replace(/\s+/gu, " "), LABEL_INPUT_MAX_LENGTH).join("");
}

const DIGITS_ONLY = /^\d+$/;

/**
 * The number a cell of the staffing grid says: 0 for an empty cell (nothing to staff that day), the number for a text of
 * digits only (ASCII digits, surrounding spaces ignored; a number the rules refuse, such as 100, is passed on for
 * `validateScheduleInput` to refuse), and undefined for anything else. `Number()` would take "0x10", "1e1" and "+5" for
 * 16, 10 and 5, so the text is checked first.
 */
export function parseCount(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") {
    return 0;
  }
  return DIGITS_ONLY.test(trimmed) ? Number(trimmed) : undefined;
}
