-- =============================================================================
-- 0001_core_schema — Huemen.studio core data model (brief §03).
--
-- INVARIANT (INV-1): EVERY table carries tenant_id. No exceptions, including
-- join tables and logs. RLS policies (0002) key on it. Do not add a table
-- without tenant_id.
-- =============================================================================

-- gen_random_uuid() is built into Postgres 13+. updated_at is maintained by a
-- shared trigger.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- tenants — the workspace record. Its tenant_id mirrors its own id so the RLS
-- rule ("tenant_id = current tenant") is uniform across every table.
-- -----------------------------------------------------------------------------
CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  name          text NOT NULL,
  custom_domain text UNIQUE,
  branding      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- palette, logo refs, fonts
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (tenant_id = id)
);

CREATE OR REPLACE FUNCTION tenants_set_self_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN NEW.tenant_id = NEW.id; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tenants_self BEFORE INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_set_self_tenant();
CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- users — belongs to one tenant. Coaches reach client tenants via
-- coach_assignments. auth_subject maps to the managed auth provider identity.
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  auth_subject text UNIQUE,
  email        text NOT NULL,
  role         text NOT NULL
                 CHECK (role IN ('owner_admin', 'coach', 'client')),
  status       text NOT NULL DEFAULT 'invited'
                 CHECK (status IN ('invited', 'active', 'disabled')),
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- coach_assignments — a coach (user in the owner org) assigned to a client
-- workspace. tenant_id = the CLIENT tenant being granted (carries tenant_id).
-- -----------------------------------------------------------------------------
CREATE TABLE coach_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  coach_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, coach_user_id)
);
CREATE INDEX idx_coach_assign_tenant ON coach_assignments(tenant_id);
CREATE INDEX idx_coach_assign_coach ON coach_assignments(coach_user_id);

-- -----------------------------------------------------------------------------
-- brand_profiles — story arc (3 chapters), positioning, niche, audience, offers.
-- -----------------------------------------------------------------------------
CREATE TABLE brand_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'active')),
  story_arc             jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{chapter,title,body}]
  positioning_statement text,
  niche                 text,
  audience              jsonb NOT NULL DEFAULT '{}'::jsonb,
  offers_summary        text,
  completeness          integer NOT NULL DEFAULT 0
                          CHECK (completeness BETWEEN 0 AND 100),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_brand_profiles_tenant ON brand_profiles(tenant_id);
CREATE TRIGGER trg_brand_profiles_updated BEFORE UPDATE ON brand_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- voice_guides
-- -----------------------------------------------------------------------------
CREATE TABLE voice_guides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_profile_id uuid NOT NULL REFERENCES brand_profiles(id) ON DELETE CASCADE,
  tone_descriptors jsonb NOT NULL DEFAULT '[]'::jsonb,
  do_words         text[] NOT NULL DEFAULT '{}',
  dont_words       text[] NOT NULL DEFAULT '{}',
  sample_posts     jsonb NOT NULL DEFAULT '[]'::jsonb,
  reading_level    text,
  formatting_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_voice_guides_tenant ON voice_guides(tenant_id);
CREATE INDEX idx_voice_guides_profile ON voice_guides(brand_profile_id);
CREATE TRIGGER trg_voice_guides_updated BEFORE UPDATE ON voice_guides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- assets — uploaded files (logos, fonts, reference images).
-- -----------------------------------------------------------------------------
CREATE TABLE assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL
                CHECK (kind IN ('logo', 'font', 'reference_image', 'other')),
  storage_key text NOT NULL,          -- tenant-prefixed (INV-1)
  mime        text NOT NULL,
  width       integer,
  height      integer,
  bytes       bigint,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_assets_tenant ON assets(tenant_id);

-- -----------------------------------------------------------------------------
-- visual_identities
-- -----------------------------------------------------------------------------
CREATE TABLE visual_identities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_profile_id      uuid NOT NULL REFERENCES brand_profiles(id) ON DELETE CASCADE,
  palette               jsonb NOT NULL DEFAULT '[]'::jsonb,  -- hex values
  fonts                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  logo_asset_id         uuid REFERENCES assets(id) ON DELETE SET NULL,
  image_style_notes     text,
  aspect_ratio_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_visual_identities_tenant ON visual_identities(tenant_id);
CREATE INDEX idx_visual_identities_profile ON visual_identities(brand_profile_id);
CREATE TRIGGER trg_visual_identities_updated BEFORE UPDATE ON visual_identities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- pillars — content pillars per brand.
-- -----------------------------------------------------------------------------
CREATE TABLE pillars (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_profile_id uuid REFERENCES brand_profiles(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pillars_tenant ON pillars(tenant_id);

-- -----------------------------------------------------------------------------
-- prompt_templates — versioned prompt bodies by key. tenant_id NULL = GLOBAL
-- template; a non-null tenant_id is a per-tenant override (brief §03).
-- -----------------------------------------------------------------------------
CREATE TABLE prompt_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,   -- NULL = global
  key          text NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  target_model text,
  params       jsonb NOT NULL DEFAULT '{}'::jsonb,
  body         text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Unique per (scope, key, version); COALESCE gives globals a stable scope key.
CREATE UNIQUE INDEX uq_prompt_templates
  ON prompt_templates (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), key, version);
CREATE INDEX idx_prompt_templates_tenant ON prompt_templates(tenant_id);

-- -----------------------------------------------------------------------------
-- content_items — generated or edited copy.
-- -----------------------------------------------------------------------------
CREATE TABLE content_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel                text NOT NULL,   -- linkedin | instagram | newsletter | email | talk
  format                 text NOT NULL,   -- linkedin_post | hook_set | ig_caption | ...
  topic                  text,
  hook                   text,
  body                   text,
  cta                    text,
  pillar_id              uuid REFERENCES pillars(id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'edited', 'approved')),
  prompt_version         integer,                       -- stamped for traceability (INV-2)
  prompt_template_id     uuid REFERENCES prompt_templates(id) ON DELETE SET NULL,
  source_content_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL, -- repurposing
  created_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_content_items_tenant ON content_items(tenant_id);
CREATE INDEX idx_content_items_pillar ON content_items(pillar_id);
CREATE TRIGGER trg_content_items_updated BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- content_generations — per-content_item generation history: each variant and
-- each regenerate-with-steer version is retained (brief §4.2).
-- -----------------------------------------------------------------------------
CREATE TABLE content_generations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  variant_index   integer NOT NULL DEFAULT 0,
  steer           text,
  hook            text,
  body            text,
  cta             text,
  prompt_version  integer,
  model           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_content_generations_tenant ON content_generations(tenant_id);
CREATE INDEX idx_content_generations_item ON content_generations(content_item_id);

-- -----------------------------------------------------------------------------
-- image_assets — generated visuals.
-- -----------------------------------------------------------------------------
CREATE TABLE image_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  content_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,  -- parent
  kind            text NOT NULL
                    CHECK (kind IN ('single', 'carousel_frame', 'quote_card', 'announcement')),
  prompt          text,
  model           text,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  aspect_ratio    text,
  storage_key     text,                       -- tenant-prefixed (INV-1)
  width           integer,
  height          integer,
  status          text NOT NULL DEFAULT 'ready'
                    CHECK (status IN ('pending', 'ready', 'error')),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_image_assets_tenant ON image_assets(tenant_id);
CREATE INDEX idx_image_assets_item ON image_assets(content_item_id);

-- -----------------------------------------------------------------------------
-- ideas — idea inbox.
-- -----------------------------------------------------------------------------
CREATE TABLE ideas (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  raw_text                    text NOT NULL,
  source                      text NOT NULL DEFAULT 'paste',
  pillar_id                   uuid REFERENCES pillars(id) ON DELETE SET NULL,
  converted_to_content_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  status                      text NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new', 'converted', 'archived')),
  created_by                  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ideas_tenant ON ideas(tenant_id);

-- -----------------------------------------------------------------------------
-- calendar_entries — scheduled slots.
-- -----------------------------------------------------------------------------
CREATE TABLE calendar_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_date      date NOT NULL,
  pillar_id       uuid REFERENCES pillars(id) ON DELETE SET NULL,
  channel         text,
  content_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  topic           text,
  hook_angle      text,
  cta             text,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'scheduled', 'published')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_calendar_entries_tenant ON calendar_entries(tenant_id);
CREATE INDEX idx_calendar_entries_date ON calendar_entries(tenant_id, entry_date);

-- -----------------------------------------------------------------------------
-- offers — offer designer output.
-- -----------------------------------------------------------------------------
CREATE TABLE offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text NOT NULL,
  format              text,
  promise             text,
  deliverables        jsonb NOT NULL DEFAULT '[]'::jsonb,
  pricing_logic_notes text,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_offers_tenant ON offers(tenant_id);
CREATE TRIGGER trg_offers_updated BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- generation_logs — every model call. The product-level audit trail (brief §05).
-- -----------------------------------------------------------------------------
CREATE TABLE generation_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('text', 'image')),
  model           text,
  tokens_in       integer,
  tokens_out      integer,
  image_count     integer,
  latency_ms      integer,
  status          text NOT NULL CHECK (status IN ('ok', 'error', 'timeout')),
  error           text,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  content_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_generation_logs_tenant ON generation_logs(tenant_id);
CREATE INDEX idx_generation_logs_created ON generation_logs(tenant_id, created_at);

-- -----------------------------------------------------------------------------
-- tenant_usage_caps — per-tenant soft warning + hard stop (brief §4.6).
-- -----------------------------------------------------------------------------
CREATE TABLE tenant_usage_caps (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_text_soft     integer,
  monthly_text_hard     integer,
  monthly_image_soft    integer,
  monthly_image_hard    integer,
  updated_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_usage_caps_updated BEFORE UPDATE ON tenant_usage_caps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- admin_audit_log — audit trail on admin actions: workspace creation, role
-- changes, cap changes (brief §07). tenant_id = target tenant.
-- -----------------------------------------------------------------------------
CREATE TABLE admin_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action        text NOT NULL,
  target        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_audit_tenant ON admin_audit_log(tenant_id);

-- -----------------------------------------------------------------------------
-- jobs — background job queue: batch generation, retries with backoff,
-- dead-letter, visible status (brief §05 Jobs).
-- -----------------------------------------------------------------------------
CREATE TABLE jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error   text,
  result       jsonb,
  progress     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- partial results retained on failure
  run_after    timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_tenant ON jobs(tenant_id);
CREATE INDEX idx_jobs_status ON jobs(status, run_after);
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
