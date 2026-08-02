import { Model, Q } from '@nozbe/watermelondb';
import { children, date, field, lazy } from '@nozbe/watermelondb/decorators';

import { Zone } from '../../scoring/scoring';
import TargetZone from './TargetZone';

export default class Target extends Model {
  static table = 'targets';

  static associations = {
    target_zones: { type: 'has_many' as const, foreignKey: 'target_id' },
    rounds: { type: 'has_many' as const, foreignKey: 'target_id' },
  };

  @field('name') name: string;
  @field('type') type: 'preset' | 'custom';
  @field('base_shape') baseShape: string | null;
  @field('aspect_ratio') aspectRatio: number | null;
  @field('face_width_cm') faceWidthCm: number | null;
  @date('created_at') createdAt: Date;
  @date('updated_at') updatedAt: Date;

  @children('target_zones') zones: TargetZone[];

  @lazy orderedZones = this.collections
    .get<TargetZone>('target_zones')
    .query(Q.where('target_id', this.id), Q.sortBy('zone_index', Q.asc));

  get isEditable(): boolean {
    return this.type === 'custom';
  }

  /** faceWidth / faceHeight. 1 when unknown, which is right for round faces. */
  get effectiveAspectRatio(): number {
    return this.aspectRatio ?? 1;
  }

  /** Zone geometry in the shape the scoring module expects. */
  async toScoringZones(): Promise<Zone[]> {
    const zones = await this.orderedZones.fetch();
    return zones.map((z) => z.toScoringZone());
  }
}
