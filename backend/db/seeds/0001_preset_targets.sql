-- 0001_preset_targets.sql — shared World Archery target faces.
--
-- NOT demo data. These are reference rows every environment needs: presets have
-- owner_id NULL, are visible to all users, and are editable by none. Run this in
-- dev, staging and prod alike.
--
-- Preset ids are FIXED, not generated. A client that caches "the archer shoots
-- the 122 cm face" must resolve to the same row in every environment, and a
-- round created against dev must still make sense when restored elsewhere.
--
-- ZONE ids are fixed too, and for a sharper reason. The app ships these same
-- presets so a new install can score before it has ever reached the network.
-- If the two sides mint different zone ids, the first sync does not reconcile
-- them — it adds a second complete set of rings to every preset face. Both
-- sides therefore derive a zone id from its target and index:
--
--     <target-suffix8>-0000-4000-8000-<zone index, 12 digits>
--
-- e.g. the 122 cm face's 10 ring is 00000101-0000-4000-8000-000000000000.
-- mobile/src/db/presets.ts builds the identical string; change one and you
-- must change the other.
--
-- All geometry is normalized 0-1 to the target face, so a 122 cm face and an
-- 80 cm face of the same ring count are geometrically identical here — they
-- differ only in physical size, which lives in the name and in sessions.distance_m.
--
-- Ring arithmetic: on an N-ring face the outer edge of the lowest-scoring ring
-- is the face edge (normalized radius 0.5), and rings are of equal width, so
-- a ring's outer radius is (ring number from centre) * 0.5 / N.

BEGIN;

INSERT INTO targets (id, owner_id, name, type, base_shape, created_at, updated_at) VALUES
    ('00000000-0000-4000-8000-000000000101', NULL, 'WA 122 cm (10 ring)',        'preset', 'circle',    now(), now()),
    ('00000000-0000-4000-8000-000000000102', NULL, 'WA 80 cm (10 ring)',         'preset', 'circle',    now(), now()),
    ('00000000-0000-4000-8000-000000000103', NULL, 'WA 80 cm compound (6 ring)', 'preset', 'circle',    now(), now()),
    ('00000000-0000-4000-8000-000000000104', NULL, 'WA 40 cm vertical 3-spot',   'preset', 'rectangle', now(), now());

-- ---------------------------------------------------------------------------
-- 10-ring faces (122 cm and 80 cm) — scores 10 down to 1
-- ---------------------------------------------------------------------------
-- zone_index 0 is the 10 ring, so the innermost zone is tested first.
-- The inner-10 (X) ring is deliberately omitted: it scores the same 10 and only
-- exists to break ties, which is a competition-format concern rather than a
-- scoring-geometry one. Add it as zone_index -1 if tiebreaks are ever needed.

INSERT INTO target_zones (id, target_id, zone_index, score_value, shape_type, shape_params, created_at, updated_at)
SELECT
    (t.prefix || '-0000-4000-8000-' || lpad(ring.idx::text, 12, '0'))::uuid,
    t.id,
    ring.idx,
    10 - ring.idx,
    'circle',
    jsonb_build_object(
        'cx', 0.5,
        'cy', 0.5,
        'r',  round(((ring.idx + 1) * 0.5 / 10)::numeric, 6)
    ),
    now(),
    now()
FROM (VALUES
    ('00000000-0000-4000-8000-000000000101'::uuid, '00000101'),
    ('00000000-0000-4000-8000-000000000102'::uuid, '00000102')
) AS t (id, prefix)
CROSS JOIN generate_series(0, 9) AS ring (idx);

-- ---------------------------------------------------------------------------
-- 80 cm compound face — 6 rings, scores 10 down to 5
-- ---------------------------------------------------------------------------
-- The outer rings of the 10-ring face are dropped; what remains is rescaled so
-- the 5 ring reaches the face edge.

INSERT INTO target_zones (id, target_id, zone_index, score_value, shape_type, shape_params, created_at, updated_at)
SELECT
    ('00000103-0000-4000-8000-' || lpad(ring.idx::text, 12, '0'))::uuid,
    '00000000-0000-4000-8000-000000000103'::uuid,
    ring.idx,
    10 - ring.idx,
    'circle',
    jsonb_build_object(
        'cx', 0.5,
        'cy', 0.5,
        'r',  round(((ring.idx + 1) * 0.5 / 6)::numeric, 6)
    ),
    now(),
    now()
FROM generate_series(0, 5) AS ring (idx);

-- ---------------------------------------------------------------------------
-- 40 cm vertical 3-spot — three 40 cm faces stacked, scores 10 down to 6
-- ---------------------------------------------------------------------------
-- The physical face is 40 cm wide by 120 cm tall. Normalizing both axes to 0-1
-- therefore squashes it: a physically circular ring becomes an ELLIPSE in
-- normalized space, with ry exactly one third of rx.
--
-- This is a real consequence of the normalized-coordinate model, not a quirk of
-- this preset — any non-square target face has it. See the note in
-- backend/db/README.md.
--
-- Layering matters here. All three 10 rings must be tested before any 9 ring,
-- so zone_index interleaves the spots: index = ring * 3 + spot.

INSERT INTO target_zones (id, target_id, zone_index, score_value, shape_type, shape_params, created_at, updated_at)
SELECT
    ('00000104-0000-4000-8000-' ||
        lpad((ring.idx * 3 + spot.idx)::text, 12, '0'))::uuid,
    '00000000-0000-4000-8000-000000000104'::uuid,
    ring.idx * 3 + spot.idx,
    10 - ring.idx,
    'ellipse',
    jsonb_build_object(
        'cx',  0.5,
        'cy',  round(((spot.idx * 2 + 1) / 6.0)::numeric, 6),  -- 1/6, 3/6, 5/6
        'rx',  round(((ring.idx + 1) * 0.1)::numeric, 6),      -- ring radius / 40 cm
        'ry',  round(((ring.idx + 1) * 0.1 / 3)::numeric, 6),  -- ring radius / 120 cm
        'rot', 0
    ),
    now(),
    now()
FROM generate_series(0, 4) AS ring (idx)
CROSS JOIN generate_series(0, 2) AS spot (idx);

COMMIT;
