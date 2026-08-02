import { Model, Q } from '@nozbe/watermelondb';
import { children, date, field, lazy, relation } from '@nozbe/watermelondb/decorators';

import Arrow from './Arrow';
import Session from './Session';
import Target from './Target';

export default class Round extends Model {
  static table = 'rounds';

  static associations = {
    arrows: { type: 'has_many' as const, foreignKey: 'round_id' },
    sessions: { type: 'belongs_to' as const, key: 'session_id' },
    targets: { type: 'belongs_to' as const, key: 'target_id' },
  };

  @field('session_id') sessionId: string;
  @field('target_id') targetId: string;
  @field('round_order') roundOrder: number;
  @field('photo_key') photoKey: string | null;
  @field('local_photo_uri') localPhotoUri: string | null;
  @date('created_at') createdAt: Date;
  @date('updated_at') updatedAt: Date;

  @relation('sessions', 'session_id') session: Session;
  @relation('targets', 'target_id') target: Target;
  @children('arrows') arrows: Arrow[];

  @lazy orderedArrows = this.collections
    .get<Arrow>('arrows')
    .query(Q.where('round_id', this.id), Q.sortBy('shot_order', Q.asc));

  /** A photo taken but not yet uploaded still has something to show. */
  get hasPhoto(): boolean {
    return this.photoKey !== null || this.localPhotoUri !== null;
  }
}
