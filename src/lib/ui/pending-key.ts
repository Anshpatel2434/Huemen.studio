/**
 * A tool key pressed before the Visual board could take keys (PI-01: the
 * first R on a fresh page did nothing, 11 of 12 tries). The root layout puts
 * PENDING_KEY_SCRIPT inline in the head, so it listens as soon as the page
 * is read (once per document): it keeps
 * the last plain letter pressed (not in a field) until the canvas is
 * listening, and the canvas (components/canvas) then plays it once. Older
 * than PENDING_KEY_MAX_MS, it is dropped. Plain module: the server page and
 * the client canvas both read it.
 */
export const PENDING_KEY_MAX_MS = 8000;
/** The key, when, and on which page (a key pressed on another page is never played here). */
export type PendingKey = { key: string; t: number; p?: string };

/** Records plain letter keys pressed before the board has loaded (not in a field), for the canvas to replay. */
export const PENDING_KEY_SCRIPT =
  "(function(){if(window.__huPendingKeyOn)return;window.__huPendingKeyOn=1;window.addEventListener('keydown',function(e){if(window.__huCanvasReady||e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;var t=e.target;if(t&&t.closest&&t.closest('input,textarea,[contenteditable],[role=dialog]'))return;if(!/^[a-z]$/i.test(e.key))return;window.__huPendingKey={key:e.key,t:Date.now(),p:location.pathname};},true);})();";
