-- 0001_init.sql — initial schema for the Archery Tracker MVP.
--
-- Implements Part 1 of docs/technical-design.md. Third normal form; no stored
-- aggregates. Score, grouping, and heat maps are derived on-device from
-- arrows.x/y + target_zones and are deliberately absent here.
--
-- Two conventions worth reading before you change anything:
--
--   1. Primary keys are CLIENT-GENERATED UUIDs. There is intentionally no
--      DEFAULT gen_random_uuid() — offline capture mints ids on the device
--      before the row ever reaches this database. A server-side default would
--      quietly let a code path invent an id the client doesn't know about.
--
--   2. updated_at is CLIENT-SUPPLIED and authoritative. /sync/push resolves
--      conflicts last-write-wins by comparing the client's updated_at. Do NOT
--      add a BEFORE UPDATE trigger that stamps now() — it would overwrite the
--      timestamp the conflict resolution depends on and make LWW meaningless.
--      The DEFAULT now() exists only so hand-written SQL and seeds work.

BEGIN;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- id mirrors the Cognito `sub` claim. Cognito is the source of truth for
-- identity and auth method (email / Google / Apple); none of that is stored here.

CREATE TABLE users (
    id                UUID PRIMARY KEY,
    email             TEXT        NOT NULL UNIQUE,
    display_name      TEXT,
    research_consent  BOOLEAN     NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  users IS 'Application profile. Identity itself lives in Cognito.';
COMMENT ON COLUMN users.id IS 'Mirrors the Cognito sub claim.';
COMMENT ON COLUMN users.research_consent IS 'Consent for research/analytics use of this user''s data.';

-- ---------------------------------------------------------------------------
-- gear_profiles
-- ---------------------------------------------------------------------------

CREATE TABLE gear_profiles (
    id          UUID PRIMARY KEY,
    owner_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    bow_type    TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT gear_profiles_name_not_blank CHECK (length(btrim(name)) > 0)
);

COMMENT ON COLUMN gear_profiles.bow_type IS 'recurve / compound / barebow / traditional / etc. Free text by design — the list of bow styles is not ours to close.';

-- ---------------------------------------------------------------------------
-- targets
-- ---------------------------------------------------------------------------
-- owner_id NULL  => shared standard preset (World Archery / Olympic faces)
-- owner_id set   => user-created custom target

CREATE TABLE targets (
    id          UUID PRIMARY KEY,
    owner_id    UUID        REFERENCES users (id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    type        TEXT        NOT NULL,
    base_shape  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT targets_type_valid CHECK (type IN ('preset', 'custom')),

    -- Ownership and type are two views of the same fact; keep them from drifting.
    CONSTRAINT targets_ownership_matches_type CHECK (
        (type = 'preset' AND owner_id IS NULL)
     OR (type = 'custom' AND owner_id IS NOT NULL)
    ),

    CONSTRAINT targets_base_shape_valid CHECK (
        base_shape IS NULL
     OR base_shape IN ('circle', 'rectangle', 'silhouette', 'freeform')
    )
);

COMMENT ON COLUMN targets.base_shape IS 'Outline shape of the physical target face.';
COMMENT ON COLUMN targets.owner_id IS 'NULL = shared preset, readable by everyone and editable by no one.';

-- ---------------------------------------------------------------------------
-- target_zones
-- ---------------------------------------------------------------------------
-- Scoring zones built from shape primitives rather than point-clouds. All
-- geometry is normalized 0-1 relative to the target face, so it renders and
-- scores identically at any resolution.
--
-- shape_params by shape_type:
--   circle    { "cx": 0.5, "cy": 0.5, "r": 0.1 }
--   ellipse   { "cx": 0.5, "cy": 0.5, "rx": 0.1, "ry": 0.15, "rot": 0 }
--   rectangle { "x": 0.2, "y": 0.3, "w": 0.4, "h": 0.2, "rot": 0 }
--   polygon   { "points": [[x1,y1],[x2,y2], ...] }
--
-- Scoring (on-device): test the arrow's (x,y) against zones in zone_index
-- order, innermost/highest first; the first zone containing the point wins.

CREATE TABLE target_zones (
    id            UUID PRIMARY KEY,
    target_id     UUID        NOT NULL REFERENCES targets (id) ON DELETE CASCADE,
    zone_index    INT         NOT NULL,
    score_value   INT         NOT NULL,
    shape_type    TEXT        NOT NULL,
    shape_params  JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT target_zones_zone_index_non_negative CHECK (zone_index >= 0),
    CONSTRAINT target_zones_score_non_negative      CHECK (score_value >= 0),

    CONSTRAINT target_zones_shape_type_valid CHECK (
        shape_type IN ('circle', 'ellipse', 'rectangle', 'polygon')
    ),

    -- Cheap structural guard. It does not validate ranges or winding order —
    -- it only stops a zone from being written with geometry that can never be
    -- interpreted, which is the failure that would silently mis-score arrows.
    CONSTRAINT target_zones_shape_params_match_type CHECK (
        CASE shape_type
            WHEN 'circle'    THEN shape_params ?& ARRAY['cx', 'cy', 'r']
            WHEN 'ellipse'   THEN shape_params ?& ARRAY['cx', 'cy', 'rx', 'ry']
            WHEN 'rectangle' THEN shape_params ?& ARRAY['x', 'y', 'w', 'h']
            WHEN 'polygon'   THEN jsonb_typeof(shape_params -> 'points') = 'array'
                              AND jsonb_array_length(shape_params -> 'points') >= 3
        END
    ),

    -- Layering order must be unambiguous, or scoring is not deterministic.
    CONSTRAINT target_zones_unique_order UNIQUE (target_id, zone_index)
);

COMMENT ON COLUMN target_zones.zone_index IS 'Layering order. Zones are tested low index first, so the innermost/highest-scoring zone must have the lowest index.';
COMMENT ON COLUMN target_zones.shape_params IS 'Geometry normalized 0-1 to the target face. Keys depend on shape_type.';

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------

CREATE TABLE sessions (
    id               UUID PRIMARY KEY,
    owner_id         UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    shot_at          TIMESTAMPTZ NOT NULL,
    distance_m       NUMERIC(6, 2),
    gear_profile_id  UUID        REFERENCES gear_profiles (id) ON DELETE SET NULL,
    equipment_tag    TEXT,
    location         TEXT,
    notes            TEXT,
    sync_status      TEXT        NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT sessions_sync_status_valid CHECK (sync_status IN ('pending', 'synced')),
    CONSTRAINT sessions_distance_positive CHECK (distance_m IS NULL OR distance_m > 0)
);

COMMENT ON COLUMN sessions.equipment_tag IS 'Free-text alternative to a saved gear profile, for one-off or borrowed kit.';
COMMENT ON COLUMN sessions.shot_at IS 'When the shooting happened — not when the row was created. A session logged the next morning still belongs to the day it was shot.';

-- Deleting a gear profile nulls the reference rather than destroying history.
-- A session shot last year is still a real session once you sell the bow.

-- ---------------------------------------------------------------------------
-- rounds
-- ---------------------------------------------------------------------------
-- One board within a session.

CREATE TABLE rounds (
    id           UUID PRIMARY KEY,
    session_id   UUID        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    target_id    UUID        NOT NULL REFERENCES targets (id) ON DELETE RESTRICT,
    round_order  INT         NOT NULL,
    photo_key    TEXT,
    sync_status  TEXT        NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT rounds_sync_status_valid   CHECK (sync_status IN ('pending', 'synced')),
    CONSTRAINT rounds_order_non_negative  CHECK (round_order >= 0),
    CONSTRAINT rounds_unique_order        UNIQUE (session_id, round_order)
);

COMMENT ON COLUMN rounds.photo_key IS 'S3 object key. NULL for manually entered rounds. Image bytes never enter this database.';
COMMENT ON COLUMN rounds.target_id IS 'ON DELETE RESTRICT: a target still referenced by shot history cannot be deleted out from under it.';

-- ---------------------------------------------------------------------------
-- arrows
-- ---------------------------------------------------------------------------
-- One mark within a round. Free-form count — no assumption of 3s or 6s.

CREATE TABLE arrows (
    id           UUID PRIMARY KEY,
    round_id     UUID        NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
    x            NUMERIC(9, 6) NOT NULL,
    y            NUMERIC(9, 6) NOT NULL,
    score_value  INT         NOT NULL,
    shot_order   INT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT arrows_x_normalized CHECK (x >= 0 AND x <= 1),
    CONSTRAINT arrows_y_normalized CHECK (y >= 0 AND y <= 1),
    CONSTRAINT arrows_score_non_negative CHECK (score_value >= 0),
    CONSTRAINT arrows_shot_order_positive CHECK (shot_order IS NULL OR shot_order > 0)
);

-- shot_order is optional, so uniqueness only applies where it is actually set.
CREATE UNIQUE INDEX arrows_unique_shot_order
    ON arrows (round_id, shot_order)
    WHERE shot_order IS NOT NULL;

COMMENT ON COLUMN arrows.x IS 'Normalized 0-1 across the target face. Raw truth; distance-from-centre and grouping are derived on-device, never stored.';
COMMENT ON COLUMN arrows.score_value IS 'Zone score resolved at mark time. The single lightly-denormalized field in the schema: persisted so a historical score survives a later edit to a custom target. 0 means the mark fell outside every scoring zone (a miss).';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- PK and UNIQUE constraints already cover targets.id, (target_id, zone_index),
-- (session_id, round_order) and the arrows shot-order index above. These are
-- the remaining access paths the app actually uses.

-- The dashboard's primary query: one user's sessions across a date range.
CREATE INDEX sessions_owner_shot_at_idx ON sessions (owner_id, shot_at DESC);

-- Loading a session's rounds in board order.
CREATE INDEX rounds_session_order_idx ON rounds (session_id, round_order);

-- Loading a round's marks.
CREATE INDEX arrows_round_idx ON arrows (round_id);

-- Rendering and scoring a target: its zones, innermost first.
CREATE INDEX target_zones_target_order_idx ON target_zones (target_id, zone_index);

-- Target library: this user's custom targets. Presets (owner_id IS NULL) are
-- indexed too, since the library screen fetches both in one go.
CREATE INDEX targets_owner_idx ON targets (owner_id);

-- /sync/pull?since= scans by change time per user. Sessions carry owner_id
-- directly; rounds and arrows are reached through their parents.
CREATE INDEX sessions_owner_updated_at_idx ON sessions (owner_id, updated_at);

-- Filtering a gear profile's sessions, and making the ON DELETE SET NULL cheap.
CREATE INDEX sessions_gear_profile_idx ON sessions (gear_profile_id)
    WHERE gear_profile_id IS NOT NULL;

-- Backs the ON DELETE RESTRICT check when a target deletion is attempted.
CREATE INDEX rounds_target_idx ON rounds (target_id);

COMMIT;
