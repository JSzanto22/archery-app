-- The archer's numbered arrow set.
--
-- How many shafts are in the set being shot. Opt-in and NULL by default:
-- knowing it lets the app work out which shaft made each mark by cycling shot
-- order through the set, which is only correct if the archer shoots their
-- arrows in order. That is a common habit, not a universal one, so nothing is
-- inferred until they say so — misattributed arrows would blame an innocent
-- shaft, which is worse than saying nothing.
--
-- Only the size is stored. Which shaft made a given mark is derived from
-- position in the session's shot order; a stored number would be a second copy
-- of that, free to disagree after an arrow is deleted and re-marked.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS arrow_set_size integer;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_arrow_set_size_sane
  CHECK (arrow_set_size IS NULL OR (arrow_set_size BETWEEN 1 AND 24));
