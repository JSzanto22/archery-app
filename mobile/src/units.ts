/**
 * Physical units for grouping figures.
 *
 * A grouping of "9.1%" is a fraction of the face and means nothing on its own:
 * 9.1% of a 122 cm face is 11 cm, but 9.1% of a 40 cm indoor face is 3.6 cm.
 * Reporting the real distance alongside the percentage is what makes the
 * number comparable between a 70 m outdoor session and an indoor one.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

export type UnitSystem = 'metric' | 'imperial';

const STORAGE_KEY = 'archery.units';
const CM_PER_INCH = 2.54;

export function formatDistance(cm: number, units: UnitSystem): string {
  if (units === 'imperial') {
    const inches = cm / CM_PER_INCH;
    // Below an inch, decimals carry real information; above it they are noise.
    return inches < 1 ? `${inches.toFixed(2)}"` : `${inches.toFixed(1)}"`;
  }
  return cm < 1 ? `${cm.toFixed(1)} cm` : `${cm.toFixed(1)} cm`;
}

/**
 * Grouping as a physical distance plus the fraction it came from.
 *
 * Returns null when the face size is unknown — better to show the percentage
 * alone than to invent a centimetre figure from an assumed diameter.
 */
export function formatGrouping(
  normalized: number | null,
  faceWidthCm: number | null,
  units: UnitSystem,
): { primary: string; secondary: string | null } {
  if (normalized === null) return { primary: '—', secondary: null };

  const percent = `${(normalized * 100).toFixed(1)}% of face`;

  if (!faceWidthCm) return { primary: percent, secondary: null };

  return {
    primary: formatDistance(normalized * faceWidthCm, units),
    secondary: percent,
  };
}

/** Reads the stored preference, defaulting to metric (World Archery's units). */
export function useUnits(): {
  units: UnitSystem;
  setUnits: (u: UnitSystem) => void;
  toggle: () => void;
} {
  const [units, setUnitsState] = useState<UnitSystem>('metric');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'metric' || stored === 'imperial') setUnitsState(stored);
      })
      // A missing or unreadable preference is not worth surfacing; the default
      // is correct for most of the world and the toggle is one tap away.
      .catch(() => undefined);
  }, []);

  const setUnits = useCallback((next: UnitSystem) => {
    setUnitsState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const toggle = useCallback(
    () => setUnits(units === 'metric' ? 'imperial' : 'metric'),
    [setUnits, units],
  );

  return { units, setUnits, toggle };
}
