-- Named rounds on a session.
--
-- Without one a score is an orphan number: not a Portsmouth, not a 720, not
-- comparable to the last one and with no handicap. The value is the id of a
-- format defined in the app (mobile/src/rounds/catalogue.ts), not a foreign
-- key — round formats are fixed definitions shipped with the client, and
-- storing them as rows would mean syncing a constant.
--
-- Nullable because freeform practice is a legitimate session with no round.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS round_format_id text;

-- Answering "how am I doing at Portsmouth?" is a scan of one archer's
-- sessions filtered by format, which is the shape of every progress query the
-- dashboard makes.
CREATE INDEX IF NOT EXISTS sessions_owner_round_idx
  ON sessions (owner_id, round_format_id, shot_at DESC);
