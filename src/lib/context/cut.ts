/**
 * Cut a text to at most `max` characters without splitting a sentence: at the
 * last sentence end (. ! ? followed by a space or the end) inside the budget,
 * or, when there is none, at the last word boundary. Text that already fits is
 * returned whole. Pure.
 *
 * Used wherever a long piece of the person's copy goes into a prompt (the
 * brand context's samples, a picture brief), so a cut never leaves half a
 * sentence for the model to act on.
 */
export function cutAtSentence(text: string, max: number): { text: string; cut: boolean } {
  const t = text.trim();
  if (t.length <= max) return { text: t, cut: false };
  for (let i = max - 1; i >= 0; i--) {
    if (".!?".includes(t[i]) && (i + 1 >= t.length || /\s/.test(t[i + 1]))) {
      return { text: t.slice(0, i + 1).trimEnd(), cut: true };
    }
  }
  const head = t.slice(0, max);
  const sp = head.search(/\s\S*$/);
  return { text: (sp > 0 ? head.slice(0, sp) : head).trimEnd(), cut: true };
}
