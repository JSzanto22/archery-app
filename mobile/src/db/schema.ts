/**
 * WatermelonDB schema — the on-device mirror of the Postgres schema in
 * `backend/db/migrations/0001_init.sql`.
 *
 * Two deliberate differences from the server:
 *
 * 1. **No `users` table.** The device holds exactly one user's data, and
 *    identity lives in Cognito. Ownership is implicit in "this is my phone",
 *    so `owner_id` columns are omitted rather than stored and ignored.
 *
 * 2. **No `sync_status` column.** WatermelonDB already tracks per-record sync
 *    state in its internal `_status` field ('created' / 'updated' / 'synced'),
 *    which is the same information. Storing a second copy would give us two
 *    sources of truth that drift. `src/db/sync.ts` maps `_status` onto the
 *    server's `sync_status` on the way out.
 *
 * Timestamps are epoch milliseconds here and ISO strings over the wire —
 * WatermelonDB's `@date` decorator expects numbers.
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb';

export default appSchema({
  // Bump alongside a migration in ./migrations.ts — never on its own.
  version: 5,
  tables: [
    tableSchema({
      name: 'gear_profiles',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'bow_type', type: 'string', isOptional: true },
        { name: 'notes', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'targets',
      columns: [
        { name: 'name', type: 'string' },
        // 'preset' | 'custom'. Presets arrive from the server and are read-only.
        { name: 'type', type: 'string' },
        { name: 'base_shape', type: 'string', isOptional: true },
        // faceWidth / faceHeight. Not in the server schema yet — see the note in
        // backend/db/README.md. Defaults to 1 (square) when unknown.
        { name: 'aspect_ratio', type: 'number', isOptional: true },
        // Physical width of the face in centimetres. Turns normalized grouping
        // into a real distance the archer can act on. Editable, because a
        // printed or home-made face is often not the standard size.
        { name: 'face_width_cm', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'target_zones',
      columns: [
        { name: 'target_id', type: 'string', isIndexed: true },
        { name: 'zone_index', type: 'number' },
        { name: 'score_value', type: 'number' },
        { name: 'shape_type', type: 'string' },
        // JSON text. SQLite has no jsonb, and the geometry is only ever read
        // whole, so there is nothing to gain from decomposing it into columns.
        { name: 'shape_params', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'sessions',
      columns: [
        { name: 'shot_at', type: 'number', isIndexed: true },
        /*
         * Which named round this was, or null for freeform practice.
         *
         * The id of an entry in src/rounds/catalogue.ts rather than a foreign
         * key: round formats are fixed definitions shipped with the app, not
         * user data, so storing them as rows would mean syncing a constant.
         */
        { name: 'round_format_id', type: 'string', isOptional: true },
        /*
         * How many numbered arrows are in the set being shot.
         *
         * Opt-in, and null by default. Set it and the app numbers each arrow by
         * cycling shot order through the set; leave it and no arrow carries a
         * number. Guessing would be worse than nothing: per-shaft analysis on
         * misattributed arrows blames the wrong shaft.
         */
        { name: 'arrow_set_size', type: 'number', isOptional: true },
        { name: 'distance_m', type: 'number', isOptional: true },
        {
          name: 'gear_profile_id',
          type: 'string',
          isOptional: true,
          isIndexed: true,
        },
        { name: 'equipment_tag', type: 'string', isOptional: true },
        { name: 'location', type: 'string', isOptional: true },
        { name: 'notes', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'rounds',
      columns: [
        { name: 'session_id', type: 'string', isIndexed: true },
        { name: 'target_id', type: 'string', isIndexed: true },
        { name: 'round_order', type: 'number' },
        { name: 'photo_key', type: 'string', isOptional: true },
        // Local file URI for a photo captured but not yet uploaded to S3. Never
        // synced — it is meaningless on any other device.
        { name: 'local_photo_uri', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'sight_marks',
      columns: [
        // Marks belong to a bow, not to an archer: a different riser or a
        // different draw weight is a different set of numbers entirely.
        { name: 'gear_profile_id', type: 'string', isIndexed: true },
        { name: 'distance_m', type: 'number' },
        /** The archer's own reading — mm, clicks, or a tape number. */
        { name: 'mark', type: 'number' },
        { name: 'notes', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'arrows',
      columns: [
        { name: 'round_id', type: 'string', isIndexed: true },
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
        { name: 'score_value', type: 'number' },
        { name: 'shot_order', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});
