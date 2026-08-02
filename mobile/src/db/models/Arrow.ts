import { Model } from '@nozbe/watermelondb';
import { date, field, relation } from '@nozbe/watermelondb/decorators';

import Round from './Round';

export default class Arrow extends Model {
  static table = 'arrows';

  static associations = {
    rounds: { type: 'belongs_to' as const, key: 'round_id' },
  };

  @field('round_id') roundId!: string;
  @field('x') x!: number;
  @field('y') y!: number;
  /**
   * Resolved at mark time, not on read. Persisted so a score stays stable if
   * the archer later edits the custom target it was shot at.
   */
  @field('score_value') scoreValue!: number;
  @field('shot_order') shotOrder!: number | null;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  @relation('rounds', 'round_id') round!: Round;

  get isMiss(): boolean {
    return this.scoreValue === 0;
  }
}
