/**
 * The eight-hue spectrum the product is named after (design system §04). Avatars,
 * identity marks and illustration fills carry it — never text or borders (those
 * use the signal/ink tiers). `hueFor` maps any stable seed (an id, an email) to
 * one hue so a given person is always the same colour. Yellow is left out of the
 * avatar rotation because white on it fails contrast.
 */
const AVATAR_HUES = ["--hue-coral", "--hue-orange", "--hue-green", "--hue-teal", "--hue-blue", "--hue-violet", "--hue-magenta"];
export function hueFor(seed: string, palette: string[] = AVATAR_HUES): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  return `var(${palette[h % palette.length]})`;
}
