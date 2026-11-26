// The character rules shared by the free-text fields (a schedule label, a shift name). Every character is written as a
// `\u` escape: most of them look like nothing in an editor, and a formatter or a copy and paste could silently lose them.

/**
 * Characters no text may hold: control characters (tab and newline too) and the bidirectional controls (U+061C, U+200E,
 * U+200F, U+202A to U+202E and U+2066 to U+2069). The latter reorder the text around them, so a label could show
 * something other than what is stored.
 */
export const CONTROL_CHARS = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

/**
 * No glyph of their own: format characters (zero-width space, joiners), combining grapheme joiner U+034F, the variation
 * selectors (U+FE00 to U+FE0F, U+180B to U+180F, U+E0100 to U+E01EF), the Khmer inherent vowels U+17B4 and U+17B5, and
 * the blank fillers that look like letters (Hangul choseong and jungseong filler U+115F and U+1160, braille blank U+2800,
 * Hangul filler U+3164, halfwidth Hangul filler U+FFA0). A text made only of them and spaces would show up as an empty
 * cell. They stay allowed inside a visible text (an emoji sequence, say), and combining marks that a letter needs, such
 * as the Polish ogonek U+0328 of a decomposed "ą", are not in this class at all.
 * The combining marks come first, so that the class does not read as a letter with a mark on it
 * (`no-misleading-character-class`). The `g` flag is for `replace`; do not use `test` or `exec` with it.
 */
export const INVISIBLE_CHARS =
  /[\u034F\u17B4\u17B5\u180B-\u180F\uFE00-\uFE0F\u{E0100}-\u{E01EF}\p{Cf}\u115F\u1160\u2800\u3164\uFFA0]/gu;

/** True when the text, once the invisible characters and the white space are taken out, still has something in it. */
export function hasVisibleText(text: string): boolean {
  return text.replace(INVISIBLE_CHARS, "").trim() !== "";
}
