import { Model, Q } from '@nozbe/watermelondb';
import {
  children,
  date,
  field,
  lazy,
  relation,
} from '@nozbe/watermelondb/decorators';

import GearProfile from './GearProfile';
import Round from './Round';

export default class Session extends Model {
  static table = 'sessions';

  static associations = {
    rounds: { type: 'has_many' as const, foreignKey: 'session_id' },
    gear_profiles: { type: 'belongs_to' as const, key: 'gear_profile_id' },
  };

  @date('shot_at') shotAt: Date;
  @field('round_format_id') roundFormatId: string | null;
  @field('distance_m') distanceM: number | null;
  @field('gear_profile_id') gearProfileId: string | null;
  @field('equipment_tag') equipmentTag: string | null;
  @field('location') location: string | null;
  @field('notes') notes: string | null;
  @date('created_at') createdAt: Date;
  @date('updated_at') updatedAt: Date;

  @relation('gear_profiles', 'gear_profile_id') gearProfile: GearProfile | null;
  @children('rounds') rounds: Round[];

  @lazy orderedRounds = this.collections
    .get<Round>('rounds')
    .query(Q.where('session_id', this.id), Q.sortBy('round_order', Q.asc));

  /** True while this session has local changes the server has not seen. */
  get isPendingSync(): boolean {
    return this.syncStatus !== 'synced';
  }
}
