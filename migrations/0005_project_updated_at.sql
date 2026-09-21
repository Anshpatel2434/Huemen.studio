-- 0005 — "Edited X ago" should mean edited. Starring a project is not an edit,
-- so the projects trigger keeps updated_at when only `starred` changed. An
-- explicit updated_at (touchProject) is always honoured.
CREATE OR REPLACE FUNCTION projects_set_updated_at() RETURNS trigger AS $$
BEGIN
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'starred' - 'updated_at') = (to_jsonb(OLD) - 'starred' - 'updated_at') THEN
    NEW.updated_at = OLD.updated_at;
  ELSE
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER trg_projects_updated ON projects;
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_set_updated_at();
