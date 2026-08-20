-- Sight marks.
--
-- The number on the sight bar that puts arrows in the middle at a given
-- distance. Arriving at 60 m without your mark costs an end finding it again,
-- which is why every archer keeps these somewhere — usually on tape round the
-- riser or in a notebook.
--
-- Keyed to a gear profile rather than to the archer: a different riser, or the
-- same riser at a different draw weight, is a different set of numbers.
--
-- `mark` is deliberately unitless. Sights are read in millimetres, in clicks,
-- or off a printed tape, and normalising them would mean guessing which.

CREATE TABLE IF NOT EXISTS sight_marks (
  id              uuid PRIMARY KEY,
  gear_profile_id uuid NOT NULL REFERENCES gear_profiles (id) ON DELETE CASCADE,
  distance_m      numeric(6, 2) NOT NULL CHECK (distance_m > 0 AND distance_m <= 500),
  mark            numeric(8, 3) NOT NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- One mark per distance per bow. Re-recording a distance is an update, not a
  -- second row: two marks for 50 m means the archer cannot tell which is
  -- current, which is exactly the problem the notebook already has.
  CONSTRAINT sight_marks_unique_distance UNIQUE (gear_profile_id, distance_m)
);

CREATE INDEX IF NOT EXISTS sight_marks_gear_idx
  ON sight_marks (gear_profile_id, distance_m);
