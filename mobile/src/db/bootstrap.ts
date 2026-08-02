/**
 * First-run setup: make sure the bundled preset faces exist locally.
 *
 * Idempotent and keyed on the preset's fixed id, so running it on every launch
 * is cheap and safe. It only creates what is missing — it never overwrites a
 * preset the server may have since revised.
 */

import { Q } from '@nozbe/watermelondb';

import { collections, database } from './index';
import { PRESET_TARGETS } from './presets';
import Target from './models/Target';
import TargetZone from './models/TargetZone';

export async function ensurePresetTargets(): Promise<number> {
  const wanted = PRESET_TARGETS.map((p) => p.id);

  const existing = await collections.targets
    .query(Q.where('id', Q.oneOf(wanted)))
    .fetch();
  const have = new Set(existing.map((t) => t.id));

  const missing = PRESET_TARGETS.filter((p) => !have.has(p.id));
  if (missing.length === 0) return 0;

  await database.write(async () => {
    const now = Date.now();

    for (const preset of missing) {
      // _raw.id assignment is how WatermelonDB accepts a caller-supplied id.
      // The preset ids must match the server's or the first sync would create
      // duplicate copies of every standard face.
      const target = await collections.targets.create((t: Target) => {
        t._raw.id = preset.id;
        t.name = preset.name;
        t.type = 'preset';
        t.baseShape = preset.baseShape;
        t.aspectRatio = preset.aspectRatio;
        t.createdAt = new Date(now);
        t.updatedAt = new Date(now);
      });

      for (const zone of preset.zones) {
        await collections.targetZones.create((z: TargetZone) => {
          z.targetId = target.id;
          z.zoneIndex = zone.zoneIndex;
          z.scoreValue = zone.scoreValue;
          z.shapeType = zone.shapeType;
          z.shapeParamsJson = JSON.stringify(zone.shapeParams);
          z.createdAt = new Date(now);
          z.updatedAt = new Date(now);
        });
      }
    }
  });

  return missing.length;
}
