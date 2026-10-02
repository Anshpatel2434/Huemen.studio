/**
 * The 80-word personality list (file 05, C5) and its families (C6). Pure.
 *
 * The spec has a model cluster the picks into four families. A fixed map does
 * the same job here: the list is closed, so every word's family can be decided
 * once and reviewed, it costs nothing per person, and two people who pick the
 * same words always see the same groups.
 */

export const FAMILIES = {
  bold: "Bold and daring",
  warm: "Warm and generous",
  sharp: "Sharp and curious",
  playful: "Playful and light",
  grounded: "Calm and grounded",
  polished: "Polished and elegant",
  energetic: "Energetic and inspiring",
  dependable: "Honest and dependable",
} as const;
export type Family = keyof typeof FAMILIES;

/** All 80 words, as file 05 lists them, each in exactly one family. */
export const WORDS: [string, Family][] = [
  ["Adventurous", "bold"], ["Ambitious", "energetic"], ["Approachable", "warm"], ["Artistic", "polished"],
  ["Aspirational", "energetic"], ["Authentic", "dependable"], ["Bold", "bold"], ["Calm", "grounded"],
  ["Caring", "warm"], ["Charismatic", "energetic"], ["Charming", "playful"], ["Cheerful", "playful"],
  ["Classic", "polished"], ["Clever", "sharp"], ["Confident", "bold"], ["Cool", "polished"],
  ["Creative", "sharp"], ["Curious", "sharp"], ["Daring", "bold"], ["Dependable", "dependable"],
  ["Distinguished", "polished"], ["Dreamy", "grounded"], ["Dynamic", "energetic"], ["Eccentric", "playful"],
  ["Elegant", "polished"], ["Energetic", "energetic"], ["Enthusiastic", "energetic"], ["Exciting", "energetic"],
  ["Expressive", "playful"], ["Fearless", "bold"], ["Feminine", "polished"], ["Fun", "playful"],
  ["Generous", "warm"], ["Genuine", "dependable"], ["Graceful", "polished"], ["Gritty", "bold"],
  ["Happy", "playful"], ["Honest", "dependable"], ["Humorous", "playful"], ["Innovative", "sharp"],
  ["Insightful", "sharp"], ["Inspiring", "energetic"], ["Intellectual", "sharp"], ["Irreverent", "bold"],
  ["Joyful", "playful"], ["Kind", "warm"], ["Laid-back", "grounded"], ["Lively", "energetic"],
  ["Luxurious", "polished"], ["Masculine", "bold"], ["Modern", "sharp"], ["Mysterious", "grounded"],
  ["Natural", "grounded"], ["Nurturing", "warm"], ["Optimistic", "energetic"], ["Passionate", "energetic"],
  ["Playful", "playful"], ["Powerful", "bold"], ["Professional", "dependable"], ["Progressive", "sharp"],
  ["Quirky", "playful"], ["Radiant", "energetic"], ["Rebellious", "bold"], ["Reliable", "dependable"],
  ["Romantic", "grounded"], ["Rustic", "grounded"], ["Sassy", "playful"], ["Sophisticated", "polished"],
  ["Strong", "bold"], ["Stylish", "polished"], ["Surprising", "sharp"], ["Sustainable", "grounded"],
  ["Thoughtful", "sharp"], ["Trustworthy", "dependable"], ["Upbeat", "playful"], ["Vibrant", "energetic"],
  ["Visionary", "sharp"], ["Warm", "warm"], ["Whimsical", "playful"], ["Youthful", "playful"],
];

export const MIN_PICKS = 12;
export const MAX_PICKS = 15;

/**
 * Group a person's picks into the families they actually used, largest first,
 * capped at four (C6). Families with a single pick still count: one word in a
 * family is still a choice the person made.
 */
export function groupPicks(picks: string[]): { family: Family; label: string; words: string[] }[] {
  const byWord = new Map(WORDS.map(([w, f]) => [w.toLowerCase(), f]));
  const groups = new Map<Family, string[]>();
  for (const p of picks) {
    const f = byWord.get(p.toLowerCase());
    if (!f) continue;
    groups.set(f, [...(groups.get(f) ?? []), p]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([family, words]) => ({ family, label: FAMILIES[family], words }));
}
