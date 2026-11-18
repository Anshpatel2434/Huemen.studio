/**
 * Text a person typed, shown as a sentence: trimmed, with a full stop added
 * only when it doesn't already end in one (. ! ? or an ellipsis, also before a
 * closing quote or bracket). "...they can predict." stays as it is rather
 * than becoming "...they can predict..".
 */
export function asSentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  return /[.!?…]["'”’)\]]*$/.test(t) ? t : `${t}.`;
}
