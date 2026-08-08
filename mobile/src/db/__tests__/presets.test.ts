/**
 * Preset identity must match the server's exactly.
 *
 * The app ships these faces so a new install can score offline; the server
 * ships them so every account sees the same standards. When the two minted
 * different zone ids, the first sync did not reconcile them — it added a
 * second complete set of rings to every preset face (20 rings on a 10-ring
 * target, 30 on the 3-spot). Scoring survived, because the duplicates were
 * identical, which is precisely why it went unnoticed.
 *
 * The scheme is mirrored in backend/db/seeds/0001_preset_targets.sql.
 */

import { PRESET_TARGETS, findPreset, presetZoneId } from '../presets';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('presetZoneId', () => {
  it('matches the documented scheme', () => {
    expect(presetZoneId('00000000-0000-4000-8000-000000000101', 0)).toBe(
      '00000101-0000-4000-8000-000000000000',
    );
    expect(presetZoneId('00000000-0000-4000-8000-000000000104', 14)).toBe(
      '00000104-0000-4000-8000-000000000014',
    );
  });

  it('produces a syntactically valid uuid', () => {
    expect(presetZoneId('00000000-0000-4000-8000-000000000102', 9)).toMatch(
      UUID,
    );
  });

  it('is stable across calls', () => {
    const a = presetZoneId('00000000-0000-4000-8000-000000000103', 3);
    const b = presetZoneId('00000000-0000-4000-8000-000000000103', 3);
    expect(a).toBe(b);
  });

  it('separates targets and indices', () => {
    const sameIndexDifferentTarget = [
      presetZoneId('00000000-0000-4000-8000-000000000101', 0),
      presetZoneId('00000000-0000-4000-8000-000000000102', 0),
    ];
    expect(new Set(sameIndexDifferentTarget).size).toBe(2);

    const sameTargetDifferentIndex = [
      presetZoneId('00000000-0000-4000-8000-000000000101', 0),
      presetZoneId('00000000-0000-4000-8000-000000000101', 1),
    ];
    expect(new Set(sameTargetDifferentIndex).size).toBe(2);
  });
});

describe('bundled presets', () => {
  it('gives every zone the deterministic id', () => {
    for (const preset of PRESET_TARGETS) {
      for (const zone of preset.zones) {
        expect(zone.id).toBe(presetZoneId(preset.id, zone.zoneIndex));
      }
    }
  });

  it('has no duplicate zone ids anywhere', () => {
    const ids = PRESET_TARGETS.flatMap((p) => p.zones.map((z) => z.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate zone indices within a face', () => {
    // The database enforces this with a UNIQUE (target_id, zone_index); the
    // bundled copy has no such guard, so it is asserted here.
    for (const preset of PRESET_TARGETS) {
      const indices = preset.zones.map((z) => z.zoneIndex);
      expect(new Set(indices).size).toBe(indices.length);
    }
  });

  it('ships the expected ring counts', () => {
    expect(findPreset('00000000-0000-4000-8000-000000000101')!.zones).toHaveLength(10);
    expect(findPreset('00000000-0000-4000-8000-000000000103')!.zones).toHaveLength(6);
    // Five rings across three spots.
    expect(findPreset('00000000-0000-4000-8000-000000000104')!.zones).toHaveLength(15);
  });

  it('carries physical dimensions for every face', () => {
    // Without these, grouping cannot be reported in centimetres.
    for (const preset of PRESET_TARGETS) {
      expect(preset.faceWidthCm).toBeGreaterThan(0);
      expect(preset.aspectRatio).toBeGreaterThan(0);
    }
  });
});
