import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { requiredBigintTransformer } from "./transformers";

@Entity()
export class ChipPosition {
  constructor(props?: Partial<ChipPosition>) {
    Object.assign(this, props);
  }

  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  basketId: string;

  @Index()
  @Column()
  user: string;

  @Column("numeric", { transformer: requiredBigintTransformer })
  shares: bigint;

  @Column("int")
  indexAtCreationBps: number;

  @Column("boolean")
  claimed: boolean;

  @Index()
  @Column("timestamptz")
  updatedAt: Date;
}
