-- ROLLBACK for 0008_brief_answers_on_brand. Run only after rolling back every
-- later migration (0009 onwards), newest first.
--
-- DATA LOSS: brand_profiles.brief_answers is dropped. Answers saved after 0008
-- exist only there; projects.brief_answers still holds what was there before.
-- Export them first if they matter:
--   psql "$DATABASE_ADMIN_URL" -c "\copy (SELECT tenant_id, brief_answers FROM brand_profiles) TO 'brief_answers.csv' CSV HEADER"
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0008_brief_answers_on_brand.down.sql
BEGIN;
ALTER TABLE brand_profiles DROP COLUMN brief_answers;
DELETE FROM _migrations WHERE id = '0008_brief_answers_on_brand.sql';
COMMIT;
