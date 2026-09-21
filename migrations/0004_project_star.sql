-- 0004 — star a project so it pins in the home sidebar (Figma "Starred").
-- Project-level (shared by everyone in the workspace), not per-user, in v1.
ALTER TABLE projects ADD COLUMN starred boolean NOT NULL DEFAULT false;
