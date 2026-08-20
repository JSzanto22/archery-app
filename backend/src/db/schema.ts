/**
 * Drizzle schema.
 *
 * This mirrors `backend/db/migrations/0001_init.sql`; it does not own it. The
 * SQL is the source of truth because it is what Docker, RDS and any future
 * migration tool actually run, and because the constraints there encode rules
 * Drizzle has no way to express (the preset-ownership check, the shape_params
 * structural guard). Drizzle exists here for typed queries, not for schema
 * management — hence `drizzle-kit generate` is deliberately not wired up.
 *
 * If you change one, change the other.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * No `.defaultRandom()` on any id: primary keys are minted on the device before
 * the row ever reaches here. See the note in the migration.
 */

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  researchConsent: boolean('research_consent').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const gearProfiles = pgTable(
  'gear_profiles',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    bowType: text('bow_type'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('gear_profiles_owner_idx').on(t.ownerId)],
);

export const targets = pgTable(
  'targets',
  {
    id: uuid('id').primaryKey(),
    /** NULL means a shared preset: readable by everyone, editable by no one. */
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    type: text('type').$type<'preset' | 'custom'>().notNull(),
    baseShape: text('base_shape'),
    /** faceWidth / faceHeight. NULL = unknown; the device assumes square. */
    aspectRatio: numeric('aspect_ratio', {
      precision: 6,
      scale: 4,
      mode: 'number',
    }),
    /** Physical width in centimetres. NULL = unknown; grouping stays a ratio. */
    faceWidthCm: numeric('face_width_cm', {
      precision: 7,
      scale: 2,
      mode: 'number',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('targets_owner_idx').on(t.ownerId)],
);

export type ShapeType = 'circle' | 'ellipse' | 'rectangle' | 'polygon';

export const targetZones = pgTable(
  'target_zones',
  {
    id: uuid('id').primaryKey(),
    targetId: uuid('target_id')
      .notNull()
      .references(() => targets.id, { onDelete: 'cascade' }),
    zoneIndex: integer('zone_index').notNull(),
    scoreValue: integer('score_value').notNull(),
    shapeType: text('shape_type').$type<ShapeType>().notNull(),
    shapeParams: jsonb('shape_params')
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('target_zones_unique_order').on(t.targetId, t.zoneIndex),
    index('target_zones_target_order_idx').on(t.targetId, t.zoneIndex),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shotAt: timestamp('shot_at', { withTimezone: true }).notNull(),
    /**
     * Which named round this was, or NULL for freeform practice.
     *
     * The id of a format defined in the client's catalogue rather than a
     * foreign key: round formats ship with the app and never change per user,
     * so a table of them would be a constant to keep in sync.
     */
    roundFormatId: text('round_format_id'),
    /**
     * How many numbered arrows are in the set being shot, or NULL.
     *
     * Which shaft made a given mark is derived on the device from shot order;
     * only the set size needs storing. See 0004_arrow_set_size.sql.
     */
    arrowSetSize: integer('arrow_set_size'),
    /*
     * `mode: 'number'` on every NUMERIC column.
     *
     * Postgres NUMERIC can exceed the precision of a JS number, so the driver
     * returns strings by default and Drizzle follows suit. Every numeric here
     * is bounded well inside a double — a distance in metres, a coordinate in
     * 0..1, a face width in centimetres — so the safety is buying nothing and
     * costing a string/number mismatch at every call site and across the wire.
     *
     * This replaces a global pg type parser that coerced OID 1700 for the
     * whole process: same effect, but declared per column where it can be
     * checked against the column's actual range.
     */
    distanceM: numeric('distance_m', {
      precision: 6,
      scale: 2,
      mode: 'number',
    }),
    gearProfileId: uuid('gear_profile_id').references(() => gearProfiles.id, {
      onDelete: 'set null',
    }),
    equipmentTag: text('equipment_tag'),
    location: text('location'),
    notes: text('notes'),
    syncStatus: text('sync_status')
      .$type<'pending' | 'synced'>()
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('sessions_owner_shot_at_idx').on(t.ownerId, t.shotAt),
    index('sessions_owner_updated_at_idx').on(t.ownerId, t.updatedAt),
  ],
);

export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => targets.id, { onDelete: 'restrict' }),
    roundOrder: integer('round_order').notNull(),
    /** S3 object key. Image bytes never enter this database. */
    photoKey: text('photo_key'),
    syncStatus: text('sync_status')
      .$type<'pending' | 'synced'>()
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('rounds_unique_order').on(t.sessionId, t.roundOrder),
    index('rounds_session_order_idx').on(t.sessionId, t.roundOrder),
    index('rounds_target_idx').on(t.targetId),
  ],
);

export const arrows = pgTable(
  'arrows',
  {
    id: uuid('id').primaryKey(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    x: numeric('x', { precision: 9, scale: 6, mode: 'number' }).notNull(),
    y: numeric('y', { precision: 9, scale: 6, mode: 'number' }).notNull(),
    /** Resolved on the device at mark time. Never computed here. */
    scoreValue: integer('score_value').notNull(),
    shotOrder: integer('shot_order'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('arrows_round_idx').on(t.roundId)],
);

export type User = typeof users.$inferSelect;
export type GearProfile = typeof gearProfiles.$inferSelect;
export type Target = typeof targets.$inferSelect;
export type TargetZone = typeof targetZones.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type Arrow = typeof arrows.$inferSelect;
