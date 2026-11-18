/**
 * Ids that arrive from the browser (a form field, a query string, an action
 * argument) are text until proven otherwise. Postgres raises "invalid input
 * syntax for type uuid" on anything else, and that raw error used to reach
 * the page. Check first and treat a bad id as "not found". Pure.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The id when it is one, else null: for optional links (a pillar, an idea). */
export const uuidOrNull = (v: unknown): string | null => (isUuid(v) ? v : null);
