-- 0002_target_face_dimensions.sql — physical dimensions of a target face.
--
-- Closes the gap documented in backend/db/README.md. The device already stored
-- both of these locally, but the server had nowhere to put them, so
-- /sync/pull returned aspect_ratio as NULL and omitted face_width_cm entirely.
-- Applying that pull would have wiped both on every device:
--
--   * aspect_ratio drives the grouping correction on non-square faces. Losing
--     it makes the WA vertical 3-spot report a group three times tighter
--     vertically than it really is.
--   * face_width_cm is what turns a normalized spread into centimetres. Losing
--     it silently reverts every grouping figure in the app to a bare
--     percentage.
--
-- Both are nullable: a face of unknown size is a real state, and inventing a
-- diameter would produce confident, wrong centimetre figures.

BEGIN;

ALTER TABLE targets
    ADD COLUMN aspect_ratio  NUMERIC(6, 4),
    ADD COLUMN face_width_cm NUMERIC(7, 2);

COMMENT ON COLUMN targets.aspect_ratio IS
    'faceWidth / faceHeight of the physical face. 1 for any round face, 1/3 for the WA vertical 3-spot. NULL means unknown, and the device assumes square.';

COMMENT ON COLUMN targets.face_width_cm IS
    'Physical width of the face in centimetres. NULL means unknown, and grouping is reported as a fraction of the face rather than a distance.';

ALTER TABLE targets
    ADD CONSTRAINT targets_aspect_ratio_positive
        CHECK (aspect_ratio IS NULL OR aspect_ratio > 0),
    ADD CONSTRAINT targets_face_width_positive
        CHECK (face_width_cm IS NULL OR face_width_cm > 0);

-- Backfill the standard faces. These are the same values the app ships in
-- mobile/src/db/presets.ts; the two must agree or a synced device will
-- disagree with a fresh install about how big a 122 cm face is.
UPDATE targets SET aspect_ratio = 1,     face_width_cm = 122
    WHERE id = '00000000-0000-4000-8000-000000000101';
UPDATE targets SET aspect_ratio = 1,     face_width_cm = 80
    WHERE id = '00000000-0000-4000-8000-000000000102';
UPDATE targets SET aspect_ratio = 1,     face_width_cm = 80
    WHERE id = '00000000-0000-4000-8000-000000000103';
UPDATE targets SET aspect_ratio = 0.3333, face_width_cm = 40
    WHERE id = '00000000-0000-4000-8000-000000000104';

COMMIT;
