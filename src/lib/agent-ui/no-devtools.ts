/**
 * OpenUI mounts its own inspector widget in development, with a banner for
 * its paid cloud. Huemen's local runs are also client demos, so it stays off:
 * react-lang skips the auto-mount when this flag is already set. Import this
 * before anything that imports @openuidev/react-lang.
 */
(globalThis as Record<symbol, unknown>)[Symbol.for("openui.devtools.autoMount")] = true;

export {};
