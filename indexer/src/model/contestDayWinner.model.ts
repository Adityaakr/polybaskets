import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { bigintTransformer, requiredBigintTransformer } from "./transformers";

@Entity()
export class ContestDayWinner {
  constructor(props?: Partial<ContestDayWinner>) {
    Object.assign(this, props);
  }

  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  dayId: string;

  @Index()
  @Column()
  user: string;

  @Column("numeric", { transformer: requiredBigintTransformer })
  realizedProfit: bigint;

  @Column("numeric", { nullable: true, transformer: bigintTransformer })
  reward: bigint | null;
}
