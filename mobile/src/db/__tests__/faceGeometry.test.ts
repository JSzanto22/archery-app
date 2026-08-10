/**
 * The resolver is the single source of face geometry for three screens, so the
 * precedence rules are pinned down here rather than left to each caller to
 * rediscover.
 */

import { isMultiSpot, resolveFaceGeometry } from '../faceGeometry';
import Target from '../models/Target';

const WA_122 = '00000000-0000-4000-8000-000000000101';
const WA_40_3SPOT = '00000000-0000-4000-8000-000000000104';

/** A stand-in with only the fields the resolver reads. */
function fakeTarget(fields: Partial<Target> & { id: string }): Target {
  return {
    aspectRatio: null,
    faceWidthCm: null,
    type: 'preset',
    ...fields,
  } as Target;
}

describe('resolveFaceGeometry', () => {
  it('falls back to the bundled preset when nothing is stored', () => {
    const face = resolveFaceGeometry(fakeTarget({ id: WA_122 }));

    expect(face.faceWidthCm).toBe(122);
    expect(face.aspectRatio).toBe(1);
    expect(face.isPreset).toBe(true);
  });

  it('prefers a stored measurement over the standard', () => {
    // A printed face is rarely the standard size, and the archer's own
    // measurement describes the thing they actually shot.
    const face = resolveFaceGeometry(
      fakeTarget({ id: WA_122, faceWidthCm: 60 }),
    );

    expect(face.faceWidthCm).toBe(60);
  });

  it('carries the squashed aspect of the 3-spot', () => {
    const face = resolveFaceGeometry(fakeTarget({ id: WA_40_3SPOT }));

    // 40 cm wide over 120 cm tall.
    expect(face.aspectRatio).toBeCloseTo(1 / 3, 3);
    expect(face.faceWidthCm).toBe(40);
  });

  it('reports an unknown face as square with no width', () => {
    // Inventing a diameter would produce confident, wrong centimetre figures.
    const face = resolveFaceGeometry(
      fakeTarget({
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        type: 'custom',
      }),
    );

    expect(face.aspectRatio).toBe(1);
    expect(face.faceWidthCm).toBeNull();
    expect(face.isPreset).toBe(false);
  });

  it('aims a custom face at its middle', () => {
    const face = resolveFaceGeometry(
      fakeTarget({
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        type: 'custom',
      }),
    );

    expect(face.aimPoints).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(isMultiSpot(face)).toBe(false);
  });
});

describe('isMultiSpot', () => {
  it('is true only for a face with several aiming points', () => {
    expect(
      isMultiSpot(resolveFaceGeometry(fakeTarget({ id: WA_40_3SPOT }))),
    ).toBe(true);
    expect(isMultiSpot(resolveFaceGeometry(fakeTarget({ id: WA_122 })))).toBe(
      false,
    );
  });

  it('puts the 3-spot s aim points on the three faces', () => {
    const face = resolveFaceGeometry(fakeTarget({ id: WA_40_3SPOT }));

    expect(face.aimPoints).toHaveLength(3);
    expect(face.aimPoints.map((p) => p.y)).toEqual([1 / 6, 3 / 6, 5 / 6]);
  });
});
