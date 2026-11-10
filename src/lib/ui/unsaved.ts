/**
 * Where unsaved edits are kept in the browser (components/unsaved-guard). A
 * plain module, so server pages can name the key a client form will use.
 */
export const UNSAVED_PREFIX = "huemen:unsaved:";

/** The storage key for one form in one workspace. */
export function unsavedKey(scope: string, form: string) {
  return `${UNSAVED_PREFIX}${scope}:${form}`;
}
