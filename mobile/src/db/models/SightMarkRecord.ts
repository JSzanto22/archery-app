import { Model } from '@nozbe/watermelondb';
import { date, field, relation } from '@nozbe/watermelondb/decorators';

import GearProfile from './GearProfile';

/**
 * A recorded sight mark.
 *
 * Named `SightMarkRecord` rather than `SightMark` so it does not collide with
 * the plain value type in scoring/sightMarks.ts, which is what the estimation
 * maths works on. The model is storage; that type is the calculation.
 */
export default class SightMarkRecord extends Model {
  static table = 'sight_marks';

  static associations = {
    gear_profiles: { type: 'belongs_to' as const, key: 'gear_profile_id' },
  };

  @field('gear_profile_id') gearProfileId: string;
  @field('distance_m') distanceM: number;
  /** The archer's own reading — mm, clicks, or a tape number. */
  @field('mark') mark: number;
  @field('notes') notes: string | null;
  @date('created_at') createdAt: Date;
  @date('updated_at') updatedAt: Date;

  @relation('gear_profiles', 'gear_profile_id') gearProfile: GearProfile;
}
