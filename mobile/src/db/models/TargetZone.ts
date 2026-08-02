import { Model } from '@nozbe/watermelondb';
import { date, field, relation } from '@nozbe/watermelondb/decorators';

import { ShapeParams, ShapeType } from '../../scoring/geometry';
import { Zone } from '../../scoring/scoring';
import Target from './Target';

export default class TargetZone extends Model {
  static table = 'target_zones';

  static associations = {
    targets: { type: 'belongs_to' as const, key: 'target_id' },
  };

  @field('target_id') targetId: string;
  @field('zone_index') zoneIndex: number;
  @field('score_value') scoreValue: number;
  @field('shape_type') shapeType: ShapeType;
  @field('shape_params') shapeParamsJson: string;
  @date('created_at') createdAt: Date;
  @date('updated_at') updatedAt: Date;

  @relation('targets', 'target_id') target: Target;

  get shapeParams(): ShapeParams {
    return JSON.parse(this.shapeParamsJson) as ShapeParams;
  }

  toScoringZone(): Zone {
    return {
      zoneIndex: this.zoneIndex,
      scoreValue: this.scoreValue,
      shapeType: this.shapeType,
      shapeParams: this.shapeParams,
    };
  }
}
