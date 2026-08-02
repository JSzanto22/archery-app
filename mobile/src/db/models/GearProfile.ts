import { Model } from '@nozbe/watermelondb';
import { children, date, field } from '@nozbe/watermelondb/decorators';

import Session from './Session';

export default class GearProfile extends Model {
  static table = 'gear_profiles';

  static associations = {
    sessions: { type: 'has_many' as const, foreignKey: 'gear_profile_id' },
  };

  @field('name') name: string;
  @field('bow_type') bowType: string | null;
  @field('notes') notes: string | null;
  @date('created_at') createdAt: Date;
  @date('updated_at') updatedAt: Date;

  @children('sessions') sessions: Session[];
}
