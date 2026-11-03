-- Stamp the context version on every model call (INV-2).
--
-- `prompt_version` on content_items records which PROMPT TEMPLATE wrote a
-- piece, which is what the brief asks for. The context block has its own
-- version, bumped whenever its shape changes, and that was never written
-- anywhere — so "trace a bad output back to the context shape that produced
-- it" was not actually possible, despite the context builder's own docstring
-- claiming it. generation_logs is the per-call audit trail, and the context
-- block is assembled per call, so it belongs here.
--
-- Nullable: rows written before this migration genuinely do not know, and a
-- backfilled guess would be worse than an honest NULL.

ALTER TABLE generation_logs ADD COLUMN context_version integer;

COMMENT ON COLUMN generation_logs.context_version IS
  'CONTEXT_VERSION of the brand context block used for this call. NULL for calls made before the column existed, or for calls that use no context.';
