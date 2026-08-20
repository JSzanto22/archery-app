/**
 * Named rounds.
 *
 * Until now a session was a loose bag of arrows, which is why nothing in the
 * app could answer "am I improving?" — a score at 70 m and a score at 18 m are
 * not the same quantity, and averaging them together is meaningless. A round
 * fixes that: it says how many arrows, at what distance, on what face, so two
 * results are comparable and a handicap can be computed.
 *
 * These are the formats a UK club actually shoots. The list is deliberately
 * short and certain rather than long and approximate: a round with the wrong
 * face size silently produces the wrong handicap, and an archer checking their
 * number against the sheet on the club wall will find the discrepancy
 * immediately.
 */

import type { Pass, Ring } from '../scoring/handicap';

export type ScoringFace = '10_zone' | '5_zone';

const YARD_IN_METRES = 0.9144;

/**
 * Metric rings: ten of them, the outermost at the edge of the face. Ring n has
 * diameter n·D/10, so the 10 ring on a 122 cm face is 12.2 cm across.
 */
function tenZone(faceDiameterM: number): Ring[] {
  return Array.from({ length: 10 }, (_, index) => ({
    radiusM: ((index + 1) * faceDiameterM) / 20,
    score: 10 - index,
  }));
}

/**
 * Imperial rings: five colours scoring 9, 7, 5, 3, 1, each a fifth of the
 * radius. Gold is 9, not 10 — the commonest surprise for an archer coming to
 * imperial rounds from metric ones.
 */
function fiveZone(faceDiameterM: number): Ring[] {
  return [9, 7, 5, 3, 1].map((score, index) => ({
    radiusM: ((index + 1) * faceDiameterM) / 10,
    score,
  }));
}

function rings(face: ScoringFace, faceDiameterCm: number): Ring[] {
  const diameterM = faceDiameterCm / 100;
  return face === '10_zone' ? tenZone(diameterM) : fiveZone(diameterM);
}

/** One distance of a round, as an archer would describe it. */
export interface RoundPass {
  arrows: number;
  distance: number;
  unit: 'm' | 'yd';
  faceDiameterCm: number;
  face: ScoringFace;
}

export interface RoundFormat {
  id: string;
  name: string;
  /** Governing body or family, shown as a chip. */
  family: 'WA' | 'AGB indoor' | 'AGB imperial';
  indoor: boolean;
  passes: RoundPass[];
  /** Arrows per end, as shot. Six outdoors, three indoors, near universally. */
  arrowsPerEnd: number;
}

export const ROUNDS: RoundFormat[] = [
  {
    id: 'wa720-70',
    name: 'WA 720 (70m)',
    family: 'WA',
    indoor: false,
    arrowsPerEnd: 6,
    passes: [
      {
        arrows: 72,
        distance: 70,
        unit: 'm',
        faceDiameterCm: 122,
        face: '10_zone',
      },
    ],
  },
  {
    id: 'wa720-60',
    name: 'WA 720 (60m)',
    family: 'WA',
    indoor: false,
    arrowsPerEnd: 6,
    passes: [
      {
        arrows: 72,
        distance: 60,
        unit: 'm',
        faceDiameterCm: 122,
        face: '10_zone',
      },
    ],
  },
  {
    id: 'wa720-50',
    name: 'WA 720 (50m)',
    family: 'WA',
    indoor: false,
    arrowsPerEnd: 6,
    passes: [
      {
        arrows: 72,
        distance: 50,
        unit: 'm',
        faceDiameterCm: 80,
        face: '10_zone',
      },
    ],
  },
  {
    id: 'wa900',
    name: 'WA 900',
    family: 'WA',
    indoor: false,
    arrowsPerEnd: 6,
    passes: [
      {
        arrows: 30,
        distance: 60,
        unit: 'm',
        faceDiameterCm: 122,
        face: '10_zone',
      },
      {
        arrows: 30,
        distance: 50,
        unit: 'm',
        faceDiameterCm: 122,
        face: '10_zone',
      },
      {
        arrows: 30,
        distance: 40,
        unit: 'm',
        faceDiameterCm: 122,
        face: '10_zone',
      },
    ],
  },
  {
    id: 'portsmouth',
    name: 'Portsmouth',
    family: 'AGB indoor',
    indoor: true,
    arrowsPerEnd: 3,
    passes: [
      {
        arrows: 60,
        distance: 20,
        unit: 'yd',
        faceDiameterCm: 60,
        face: '10_zone',
      },
    ],
  },
  {
    id: 'wa18',
    name: 'WA 18',
    family: 'AGB indoor',
    indoor: true,
    arrowsPerEnd: 3,
    passes: [
      {
        arrows: 60,
        distance: 18,
        unit: 'm',
        faceDiameterCm: 40,
        face: '10_zone',
      },
    ],
  },
  {
    id: 'bray1',
    name: 'Bray I',
    family: 'AGB indoor',
    indoor: true,
    arrowsPerEnd: 3,
    passes: [
      {
        arrows: 30,
        distance: 20,
        unit: 'yd',
        faceDiameterCm: 40,
        face: '10_zone',
      },
    ],
  },
  {
    id: 'stafford',
    name: 'Stafford',
    family: 'AGB indoor',
    indoor: true,
    arrowsPerEnd: 6,
    passes: [
      {
        arrows: 72,
        distance: 30,
        unit: 'm',
        faceDiameterCm: 80,
        face: '10_zone',
      },
    ],
  },
  {
    id: 'national',
    name: 'National',
    family: 'AGB imperial',
    indoor: false,
    arrowsPerEnd: 6,
    passes: [
      {
        arrows: 48,
        distance: 60,
        unit: 'yd',
        faceDiameterCm: 122,
        face: '5_zone',
      },
      {
        arrows: 24,
        distance: 50,
        unit: 'yd',
        faceDiameterCm: 122,
        face: '5_zone',
      },
    ],
  },
  {
    id: 'warwick',
    name: 'Warwick',
    family: 'AGB imperial',
    indoor: false,
    arrowsPerEnd: 6,
    passes: [
      {
        arrows: 24,
        distance: 60,
        unit: 'yd',
        faceDiameterCm: 122,
        face: '5_zone',
      },
      {
        arrows: 24,
        distance: 50,
        unit: 'yd',
        faceDiameterCm: 122,
        face: '5_zone',
      },
    ],
  },
  {
    id: 'western',
    name: 'Western',
    family: 'AGB imperial',
    indoor: false,
    arrowsPerEnd: 6,
    passes: [
      {
        arrows: 48,
        distance: 60,
        unit: 'yd',
        faceDiameterCm: 122,
        face: '5_zone',
      },
      {
        arrows: 48,
        distance: 50,
        unit: 'yd',
        faceDiameterCm: 122,
        face: '5_zone',
      },
    ],
  },
];

export function findRound(id: string): RoundFormat | null {
  return ROUNDS.find((round) => round.id === id) ?? null;
}

export function distanceInMetres(pass: RoundPass): number {
  return pass.unit === 'm' ? pass.distance : pass.distance * YARD_IN_METRES;
}

/** Total arrows in the round. */
export function arrowCount(round: RoundFormat): number {
  return round.passes.reduce((total, pass) => total + pass.arrows, 0);
}

/** The score for a perfect round — every arrow in the innermost ring. */
export function maxScore(round: RoundFormat): number {
  return round.passes.reduce((total, pass) => {
    const best = pass.face === '10_zone' ? 10 : 9;
    return total + pass.arrows * best;
  }, 0);
}

/** The round in the form the handicap engine works on. */
export function toPasses(round: RoundFormat): Pass[] {
  return round.passes.map((pass) => ({
    arrows: pass.arrows,
    distanceM: distanceInMetres(pass),
    rings: rings(pass.face, pass.faceDiameterCm),
    indoor: round.indoor,
  }));
}

/** "72 arrows at 70m" / "48 at 60yd, 24 at 50yd". */
export function describe(round: RoundFormat): string {
  return round.passes
    .map((pass) => `${pass.arrows} at ${pass.distance}${pass.unit}`)
    .join(', ');
}
