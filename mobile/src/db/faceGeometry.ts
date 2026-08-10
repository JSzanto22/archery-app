/**
 * Everything the analytics need to know about a physical target face.
 *
 * Three screens each worked this out for themselves — marking, session detail
 * and the dashboard hook — with slightly different fallbacks: one read the
 * aspect ratio from the target, another from the bundled preset, a third
 * defaulted to square. They agreed today by luck rather than construction, and
 * a disagreement would be invisible: grouping would simply be wrong on one
 * screen and right on another.
 */

import { Point } from '../scoring/geometry';
import Target from './models/Target';
import { findPreset } from './presets';

export interface FaceGeometry {
  /** faceWidth / faceHeight. 1 for any round face. */
  aspectRatio: number;
  /** Physical width, or null when unknown — grouping then stays a ratio. */
  faceWidthCm: number | null;
  /** Where the archer aims. More than one on a multi-spot face. */
  aimPoints: Point[];
  /** Shared standard face rather than one the archer built. */
  isPreset: boolean;
}

const CENTRE: Point[] = [{ x: 0.5, y: 0.5 }];

/**
 * Stored values win over the bundled preset's.
 *
 * A preset carries the standard dimensions, but the archer may have measured
 * their own printed face — and their measurement beats the standard, since it
 * describes the thing they actually shot.
 */
export function resolveFaceGeometry(target: Target): FaceGeometry {
  const preset = findPreset(target.id);

  return {
    aspectRatio: target.aspectRatio ?? preset?.aspectRatio ?? 1,
    faceWidthCm: target.faceWidthCm ?? preset?.faceWidthCm ?? null,
    // Aim points are geometry the app knows about standard faces only; a
    // custom target is aimed at its middle until the builder can say otherwise.
    aimPoints: preset?.aimPoints ?? CENTRE,
    isPreset: target.type === 'preset',
  };
}

/** True when the face has more than one aiming point, as a 3-spot does. */
export function isMultiSpot(geometry: FaceGeometry): boolean {
  return geometry.aimPoints.length > 1;
}
