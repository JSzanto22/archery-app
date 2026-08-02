-- 0002_demo_data.sql — a fabricated but realistic archer's history.
--
-- DEV AND TEST ONLY. Never run this against staging or production.
--
-- The point of this file is that the data is *consistent with how the app is
-- actually used*, not merely non-null:
--
--   * Arrow positions are drawn from a 2D normal distribution around the aim
--     point, because that is how shot groups genuinely scatter. Uniform random
--     x/y would produce heat maps and grouping numbers that look like noise and
--     would hide any bug in the analytics that a real group would expose.
--   * The group tightens over the seeded 7 months, and a small low-left bias
--     shrinks with it. The dashboard's score and grouping trend lines therefore
--     have something true to show.
--   * Roughly 6% of arrows are flyers, drawn with a much wider spread. Real
--     scorecards have them; code that assumes a clean distribution should meet
--     one in dev rather than in the field.
--   * score_value is resolved by genuinely testing each arrow against the
--     target's zones, exactly as the device does — never guessed. An arrow
--     outside every zone scores 0, and a few of them do miss.
--   * The two most recent sessions are left sync_status = 'pending', so the
--     offline/unsynced UI path has data the moment you open the app.
--
-- Shot scatter is deterministic (setseed below), so re-seeding reproduces the
-- same history and screenshots stay comparable. Row ids are not deterministic.

BEGIN;

-- ---------------------------------------------------------------------------
-- Seed-only scoring helpers
-- ---------------------------------------------------------------------------
-- These live in pg_temp deliberately. Scoring belongs on the device, per the
-- architecture principle in docs/technical-design.md — putting a permanent
-- score_arrow() in the schema would invite the backend to start using it. These
-- exist only to resolve score_value while seeding, and vanish with the session.

CREATE FUNCTION pg_temp.point_in_shape(
    p_shape_type text,
    p_params     jsonb,
    p_x          double precision,
    p_y          double precision
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
    cx double precision; cy double precision; r double precision;
    rx double precision; ry double precision;
    x0 double precision; y0 double precision; w double precision; h double precision;
    pts jsonb; n int; i int; j int;
    xi double precision; yi double precision;
    xj double precision; yj double precision;
    inside boolean := false;
BEGIN
    CASE p_shape_type

        WHEN 'circle' THEN
            cx := (p_params ->> 'cx')::double precision;
            cy := (p_params ->> 'cy')::double precision;
            r  := (p_params ->> 'r')::double precision;
            RETURN ((p_x - cx) ^ 2 + (p_y - cy) ^ 2) <= r ^ 2;

        WHEN 'ellipse' THEN
            -- 'rot' is ignored: every seeded ellipse is axis-aligned. A device
            -- implementation must rotate the point into the ellipse's frame first.
            cx := (p_params ->> 'cx')::double precision;
            cy := (p_params ->> 'cy')::double precision;
            rx := (p_params ->> 'rx')::double precision;
            ry := (p_params ->> 'ry')::double precision;
            RETURN (((p_x - cx) / rx) ^ 2 + ((p_y - cy) / ry) ^ 2) <= 1.0;

        WHEN 'rectangle' THEN
            x0 := (p_params ->> 'x')::double precision;
            y0 := (p_params ->> 'y')::double precision;
            w  := (p_params ->> 'w')::double precision;
            h  := (p_params ->> 'h')::double precision;
            RETURN p_x >= x0 AND p_x <= x0 + w AND p_y >= y0 AND p_y <= y0 + h;

        WHEN 'polygon' THEN
            -- Standard ray casting: count crossings of a ray cast in +x.
            pts := p_params -> 'points';
            n := jsonb_array_length(pts);
            j := n - 1;
            FOR i IN 0 .. n - 1 LOOP
                xi := (pts -> i ->> 0)::double precision;
                yi := (pts -> i ->> 1)::double precision;
                xj := (pts -> j ->> 0)::double precision;
                yj := (pts -> j ->> 1)::double precision;
                IF ((yi > p_y) <> (yj > p_y))
                   AND (p_x < (xj - xi) * (p_y - yi) / (yj - yi) + xi)
                THEN
                    inside := NOT inside;
                END IF;
                j := i;
            END LOOP;
            RETURN inside;

        ELSE
            RETURN false;
    END CASE;
END;
$fn$;

CREATE FUNCTION pg_temp.score_arrow(
    p_target_id uuid,
    p_x         double precision,
    p_y         double precision
) RETURNS int
LANGUAGE plpgsql AS $fn$
DECLARE
    z record;
BEGIN
    -- Innermost zone first, first containing zone wins — the same rule the
    -- device applies.
    FOR z IN
        SELECT shape_type, shape_params, score_value
        FROM target_zones
        WHERE target_id = p_target_id
        ORDER BY zone_index
    LOOP
        IF pg_temp.point_in_shape(z.shape_type, z.shape_params, p_x, p_y) THEN
            RETURN z.score_value;
        END IF;
    END LOOP;

    RETURN 0;  -- outside every zone: a miss
END;
$fn$;

-- ---------------------------------------------------------------------------
-- The demo archer
-- ---------------------------------------------------------------------------

INSERT INTO users (id, email, display_name, research_consent, created_at, updated_at)
VALUES (
    '11111111-1111-4111-8111-000000000000',
    'demo.archer@example.com',
    'Demo Archer',
    true,
    date_trunc('day', now()) - interval '214 days',
    date_trunc('day', now()) - interval '214 days'
);

INSERT INTO gear_profiles (id, owner_id, name, bow_type, notes, created_at, updated_at) VALUES
    ('11111111-1111-4111-8111-000000000001',
     '11111111-1111-4111-8111-000000000000',
     'Hoyt Formula X / 68" 38lb',
     'recurve',
     'Easton X10 500s, 28.75" carbon-to-throat. Beiter plunger, 0.5 mm centre shot right.',
     date_trunc('day', now()) - interval '214 days',
     date_trunc('day', now()) - interval '214 days'),

    ('11111111-1111-4111-8111-000000000002',
     '11111111-1111-4111-8111-000000000000',
     'Mathews TRX 38 / 52lb',
     'compound',
     'Indoor and 3D rig. 27" draw, scope 4x, thumb release.',
     date_trunc('day', now()) - interval '150 days',
     date_trunc('day', now()) - interval '150 days');

-- ---------------------------------------------------------------------------
-- A user-built custom target: 3D deer, scored 12 / 10 / 8 / 5
-- ---------------------------------------------------------------------------
-- Exercises the parts of the model the World Archery presets never touch:
-- polygon zones, a silhouette base_shape, non-contiguous score values, and a
-- target whose zones are not concentric.

INSERT INTO targets (id, owner_id, name, type, base_shape, created_at, updated_at)
VALUES (
    '11111111-1111-4111-8111-000000000003',
    '11111111-1111-4111-8111-000000000000',
    '3D deer (club course)',
    'custom',
    'silhouette',
    date_trunc('day', now()) - interval '148 days',
    date_trunc('day', now()) - interval '148 days'
);

INSERT INTO target_zones (id, target_id, zone_index, score_value, shape_type, shape_params, created_at, updated_at) VALUES
    -- 0: inner 12 ring
    (gen_random_uuid(), '11111111-1111-4111-8111-000000000003', 0, 12, 'circle',
     '{"cx": 0.45, "cy": 0.44, "r": 0.035}'::jsonb,
     date_trunc('day', now()) - interval '148 days', date_trunc('day', now()) - interval '148 days'),

    -- 1: vital
    (gen_random_uuid(), '11111111-1111-4111-8111-000000000003', 1, 10, 'circle',
     '{"cx": 0.45, "cy": 0.44, "r": 0.09}'::jsonb,
     date_trunc('day', now()) - interval '148 days', date_trunc('day', now()) - interval '148 days'),

    -- 2: torso
    (gen_random_uuid(), '11111111-1111-4111-8111-000000000003', 2, 8, 'polygon',
     '{"points": [[0.30,0.30],[0.46,0.25],[0.62,0.28],[0.66,0.42],[0.62,0.58],[0.44,0.60],[0.32,0.52],[0.28,0.40]]}'::jsonb,
     date_trunc('day', now()) - interval '148 days', date_trunc('day', now()) - interval '148 days'),

    -- 3: anywhere else on the animal
    (gen_random_uuid(), '11111111-1111-4111-8111-000000000003', 3, 5, 'polygon',
     '{"points": [[0.10,0.30],[0.16,0.24],[0.20,0.16],[0.24,0.24],[0.34,0.26],[0.46,0.22],[0.62,0.24],[0.70,0.34],[0.68,0.52],[0.72,0.86],[0.64,0.86],[0.60,0.60],[0.40,0.62],[0.38,0.86],[0.30,0.86],[0.28,0.56],[0.20,0.44],[0.14,0.36]]}'::jsonb,
     date_trunc('day', now()) - interval '148 days', date_trunc('day', now()) - interval '148 days');

-- ---------------------------------------------------------------------------
-- Seven months of shooting
-- ---------------------------------------------------------------------------

DO $seed$
DECLARE
    c_user           CONSTANT uuid := '11111111-1111-4111-8111-000000000000';
    c_gear_recurve   CONSTANT uuid := '11111111-1111-4111-8111-000000000001';
    c_gear_compound  CONSTANT uuid := '11111111-1111-4111-8111-000000000002';
    c_target_deer    CONSTANT uuid := '11111111-1111-4111-8111-000000000003';

    c_wa122          CONSTANT uuid := '00000000-0000-4000-8000-000000000101';
    c_wa80           CONSTANT uuid := '00000000-0000-4000-8000-000000000102';
    c_wa80_compound  CONSTANT uuid := '00000000-0000-4000-8000-000000000103';
    c_wa40_3spot     CONSTANT uuid := '00000000-0000-4000-8000-000000000104';

    c_sessions       CONSTANT int := 46;
    c_start          CONSTANT timestamptz := date_trunc('day', now()) - interval '214 days';

    c_notes CONSTANT text[] := ARRAY[
        'Gusting crosswind left to right, held off the 8 ring all afternoon.',
        'New string, first outing. Brace height settled after the third end.',
        'Tab is glazing, string fingers slipping on release.',
        'Best form of the month. Back tension finally clicking.',
        'Shoulder tight from the start, called it early.',
        'Flat light, could barely pick up the gold at distance.',
        'Dropped the clicker timing on the last two ends.',
        'Practised the shot sequence between ends rather than chasing score.',
        'Rain on and off. Arrows coming out of the boss wet.',
        'Sight mark two clicks low all session, corrected too late.'
    ];

    v_i         int;
    v_r         int;
    v_a         int;
    v_day       int := 0;

    v_session   uuid;
    v_round     uuid;
    v_shot_at   timestamptz;
    v_sync      text;

    v_skill     double precision;   -- 1.20 (early, loose) -> 0.80 (late, tight)
    v_form      double precision;   -- per-session variation on top of skill
    v_pick      double precision;

    v_distance  numeric;
    v_target    uuid;
    v_gear      uuid;
    v_tag       text;
    v_location  text;
    v_notes     text;

    v_n_rounds  int;
    v_n_arrows  int;
    v_3spot     boolean;

    v_sigma_x   double precision;
    v_sigma_y   double precision;
    v_bias_x    double precision;
    v_bias_y    double precision;
    v_aim_x     double precision;
    v_aim_y     double precision;

    v_u1        double precision;
    v_u2        double precision;
    v_flyer     double precision;
    v_x         double precision;
    v_y         double precision;
BEGIN
    PERFORM setseed(0.4242);

    FOR v_i IN 0 .. c_sessions - 1 LOOP

        -- Two or three outings a week, unevenly spaced. Nobody shoots on a grid.
        v_day := v_day + 2 + floor(random() * 6)::int;
        v_shot_at := c_start
                   + make_interval(days => v_day)
                   + make_interval(hours => 9 + floor(random() * 9)::int,
                                   mins  => floor(random() * 60)::int);

        v_skill := 1.20 - 0.40 * (v_i::double precision / (c_sessions - 1));
        v_form  := 0.88 + random() * 0.30;

        -- Which discipline this outing was. Sigma is expressed in normalized
        -- units: physical group sigma in cm divided by the face width in cm.
        v_pick := random();
        v_3spot := false;

        IF v_pick < 0.30 THEN
            -- Indoor 18 m on the vertical 3-spot. One arrow per spot.
            v_distance := 18;
            v_target   := c_wa40_3spot;
            v_gear     := c_gear_recurve;
            v_location := 'Riverside Indoor Range';
            v_n_rounds := 7 + floor(random() * 4)::int;
            v_n_arrows := 3;
            v_3spot    := true;
            -- 2.8 cm group on a 40 cm wide, 120 cm tall face: the aspect ratio
            -- squashes y to a third of x in normalized space.
            v_sigma_x  := 2.8 / 40.0;
            v_sigma_y  := 2.8 / 120.0;
            v_aim_x    := 0.5;
            v_aim_y    := 0.5;   -- overridden per arrow below

        ELSIF v_pick < 0.50 THEN
            v_distance := 70;
            v_target   := c_wa122;
            v_gear     := c_gear_recurve;
            v_location := 'County Field, main line';
            v_n_rounds := 4 + floor(random() * 3)::int;
            v_n_arrows := 6;
            v_sigma_x  := 11.0 / 122.0;
            v_sigma_y  := 11.0 / 122.0;
            v_aim_x    := 0.5;
            v_aim_y    := 0.5;

        ELSIF v_pick < 0.68 THEN
            v_distance := 30;
            v_target   := c_wa80;
            v_gear     := c_gear_recurve;
            v_location := 'County Field, short line';
            v_n_rounds := 4 + floor(random() * 3)::int;
            v_n_arrows := 6;
            v_sigma_x  := 5.5 / 80.0;
            v_sigma_y  := 5.5 / 80.0;
            v_aim_x    := 0.5;
            v_aim_y    := 0.5;

        ELSIF v_pick < 0.84 THEN
            v_distance := 50;
            v_target   := c_wa80_compound;
            v_gear     := c_gear_compound;
            v_location := 'County Field, main line';
            v_n_rounds := 4 + floor(random() * 3)::int;
            v_n_arrows := 6;
            v_sigma_x  := 6.5 / 80.0;
            v_sigma_y  := 6.5 / 80.0;
            v_aim_x    := 0.5;
            v_aim_y    := 0.5;

        ELSE
            -- 3D course. Unknown distance is the whole game; call it ~25 m.
            v_distance := 25;
            v_target   := c_target_deer;
            v_gear     := c_gear_compound;
            v_location := 'Ashdown 3D course';
            v_n_rounds := 6 + floor(random() * 5)::int;
            v_n_arrows := 2;
            v_sigma_x  := 5.0 / 60.0;   -- ~60 cm wide animal
            v_sigma_y  := 5.0 / 60.0;
            v_aim_x    := 0.45;         -- aim the vital, not the face centre
            v_aim_y    := 0.44;
        END IF;

        v_sigma_x := v_sigma_x * v_skill * v_form;
        v_sigma_y := v_sigma_y * v_skill * v_form;

        -- A persistent low-left bias, expressed as a fraction of group size so
        -- it shrinks along with the group as the archer improves.
        v_bias_x := v_sigma_x * (-0.45 + random() * 0.30);
        v_bias_y := v_sigma_y * ( 0.20 + random() * 0.40);

        -- Roughly one session in twelve uses borrowed kit, logged as free text
        -- instead of a saved profile.
        IF random() < 0.08 THEN
            v_tag  := 'Club loan recurve, 26 lb, unknown arrows';
            v_gear := NULL;
        ELSE
            v_tag := NULL;
        END IF;

        IF random() < 0.45 THEN
            v_notes := c_notes[1 + floor(random() * array_length(c_notes, 1))::int];
        ELSE
            v_notes := NULL;
        END IF;

        -- The two most recent outings have not reached the server yet.
        v_sync := CASE WHEN v_i >= c_sessions - 2 THEN 'pending' ELSE 'synced' END;

        v_session := gen_random_uuid();

        INSERT INTO sessions (
            id, owner_id, shot_at, distance_m, gear_profile_id, equipment_tag,
            location, notes, sync_status, created_at, updated_at
        ) VALUES (
            v_session, c_user, v_shot_at, v_distance, v_gear, v_tag,
            v_location, v_notes, v_sync,
            v_shot_at, v_shot_at + interval '1 hour'
        );

        FOR v_r IN 1 .. v_n_rounds LOOP

            v_round := gen_random_uuid();

            INSERT INTO rounds (
                id, session_id, target_id, round_order, photo_key,
                sync_status, created_at, updated_at
            ) VALUES (
                v_round, v_session, v_target, v_r,
                -- Most rounds are photographed; some are keyed in by hand.
                CASE WHEN random() < 0.65
                     THEN 'u/' || c_user || '/rounds/' || v_round || '/original.jpg'
                     ELSE NULL
                END,
                v_sync,
                v_shot_at + make_interval(mins => (v_r - 1) * 4),
                v_shot_at + make_interval(mins => (v_r - 1) * 4 + 3)
            );

            FOR v_a IN 1 .. v_n_arrows LOOP

                -- On a 3-spot you put one arrow in each face.
                IF v_3spot THEN
                    v_aim_y := (v_a * 2 - 1) / 6.0;
                END IF;

                -- Box-Muller: one uniform pair gives two independent normals.
                v_u1 := greatest(random(), 1e-12);
                v_u2 := random();

                -- ~6% of shots are flyers, drawn from a much wider distribution.
                v_flyer := CASE WHEN random() < 0.06 THEN 2.6 ELSE 1.0 END;

                v_x := v_aim_x + v_bias_x
                     + sqrt(-2 * ln(v_u1)) * cos(2 * pi() * v_u2) * v_sigma_x * v_flyer;
                v_y := v_aim_y + v_bias_y
                     + sqrt(-2 * ln(v_u1)) * sin(2 * pi() * v_u2) * v_sigma_y * v_flyer;

                -- A mark cannot land off the photographed face.
                v_x := least(greatest(v_x, 0.0005), 0.9995);
                v_y := least(greatest(v_y, 0.0005), 0.9995);

                INSERT INTO arrows (
                    id, round_id, x, y, score_value, shot_order, created_at, updated_at
                ) VALUES (
                    gen_random_uuid(),
                    v_round,
                    round(v_x::numeric, 6),
                    round(v_y::numeric, 6),
                    pg_temp.score_arrow(v_target, v_x, v_y),
                    v_a,
                    v_shot_at + make_interval(mins => (v_r - 1) * 4, secs => v_a * 20),
                    v_shot_at + make_interval(mins => (v_r - 1) * 4, secs => v_a * 20)
                );

            END LOOP;
        END LOOP;
    END LOOP;
END;
$seed$;

COMMIT;

-- ---------------------------------------------------------------------------
-- What got made
-- ---------------------------------------------------------------------------

DO $report$
DECLARE
    v_sessions int;
    v_rounds   int;
    v_arrows   int;
    v_avg      numeric;
    v_misses   int;
    v_first    date;
    v_last     date;
BEGIN
    SELECT count(*), min(shot_at)::date, max(shot_at)::date
      INTO v_sessions, v_first, v_last
      FROM sessions;

    SELECT count(*) INTO v_rounds FROM rounds;

    SELECT count(*), round(avg(score_value), 2), count(*) FILTER (WHERE score_value = 0)
      INTO v_arrows, v_avg, v_misses
      FROM arrows;

    RAISE NOTICE 'Seeded % sessions, % rounds, % arrows from % to %.',
        v_sessions, v_rounds, v_arrows, v_first, v_last;
    RAISE NOTICE 'Mean arrow score %, with % complete misses.', v_avg, v_misses;
END;
$report$;
