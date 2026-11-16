/**
 * How long a spoken answer has to be before it is worth keeping as a voice
 * sample, and the counter the screens use to say so.
 *
 * Both onboarding flows ask the same three questions and both gate on the
 * same length. They had the rule written out separately and said nothing
 * about it, so someone who answered all three in four words each met a
 * disabled button under a note telling them to answer the questions. The rule
 * lives here now, and the screens read the same number they enforce.
 *
 * Why there is a floor at all: four words cannot show rhythm, sentence length
 * or the way someone opens a thought, which is what the voice pack measures.
 * A shorter answer is not kept, so the person must be able to see that coming.
 */

/** The shortest answer worth measuring a voice from. */
export const MIN_SPOKEN_WORDS = 10;

/** Words in a free-text answer; 0 for blank or whitespace. */
export function wordsIn(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Whether this answer is long enough to keep. */
export function longEnough(text: string): boolean {
  return wordsIn(text) >= MIN_SPOKEN_WORDS;
}

/**
 * What to show under an answer box. `null` while it is empty — an untouched
 * field needs no scolding.
 */
export function spokenHint(text: string): { text: string; ok: boolean } | null {
  const n = wordsIn(text);
  if (n === 0) return null;
  return n >= MIN_SPOKEN_WORDS
    ? { text: `${n} words — that works`, ok: true }
    : { text: `${n} of about ${MIN_SPOKEN_WORDS} words`, ok: false };
}
