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
      // Physical face width, so grouping can be reported in centimetres rather
      // than only as a fraction of the face.
      toVersion: 2,
      steps: [
        addColumns({
          table: 'targets',
          columns: [{ name: 'face_width_cm', type: 'number', isOptional: true }],
        }),
      ],
    },
  ],
});
