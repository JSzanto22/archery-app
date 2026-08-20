/**
 * Local schema migrations.
 *
 * WatermelonDB refuses to open a database whose stored version is older than
 * the schema's without a migration path — and rightly so: silently recreating
 * it would delete a session recorded at the range and not yet synced.
 */

import {
  addColumns,
  schemaMigrations,
} from '@nozbe/watermelondb/Schema/migrations';

export default schemaMigrations({
  migrations: [
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
