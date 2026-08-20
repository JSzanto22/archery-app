/**
 * Local schema migrations.
 *
 * WatermelonDB refuses to open a database whose stored version is older than
 * the schema's without a migration path — and rightly so: silently recreating
 * it would delete a session recorded at the range and not yet synced.
 */

import {
  addColumns,
  createTable,
  schemaMigrations,
} from '@nozbe/watermelondb/Schema/migrations';

export default schemaMigrations({
  migrations: [
    {
      // Sight marks. Arriving at 60 m without your mark costs an end finding
      // it again, which is why every archer keeps these somewhere.
      toVersion: 5,
      steps: [
        createTable({
          name: 'sight_marks',
          columns: [
            { name: 'gear_profile_id', type: 'string', isIndexed: true },
            { name: 'distance_m', type: 'number' },
            { name: 'mark', type: 'number' },
            { name: 'notes', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
    {
      // How many numbered arrows are in the set being shot, so a shaft that
      // consistently lands wide can be identified rather than suspected.
      //
      // Only the set size is stored. Which shaft made a given mark is derived
      // from its position in the session's shot order — a stored number would
      // be a second copy of that, free to disagree after an arrow is deleted
      // and re-marked.
      toVersion: 4,
      steps: [
        addColumns({
          table: 'sessions',
          columns: [
            { name: 'arrow_set_size', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
    {
      // Named rounds. Without one a score is an orphan number: not a
      // Portsmouth, not comparable to the last one, and with no handicap.
      toVersion: 3,
      steps: [
        addColumns({
          table: 'sessions',
          columns: [
            { name: 'round_format_id', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      // Physical face width, so grouping can be reported in centimetres rather
      // than only as a fraction of the face.
      toVersion: 2,
      steps: [
        addColumns({
          table: 'targets',
          columns: [
            { name: 'face_width_cm', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
  ],
});
