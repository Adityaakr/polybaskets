import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class RequestVoucherDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(66) // 0x + 64 hex chars (Vara address)
  account: string;

  /**
   * One or more program addresses to register on the voucher. Batch registration
   * lets an agent cover all its target programs with a single POST so the 1h
   * per-wallet rate limit does not block initial setup.
   *
   * Cap of 10 = current PolyBaskets program surface (BasketMarket, BetToken,
   * BetLane) with headroom. Raise via env only if operationally required.
   */
  @ValidateIf((o) => o.program === undefined) // skip if old-shape compat path fires
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(66, { each: true })
  programs: string[];

  /**
   * DEPRECATED: legacy `{ account, program: string }` shape. Accepted only so
   * the service can emit a specific migration error instead of the generic
   * "programs must be an array" from class-validator. Will be removed after
   * skills migration (task #15) lands.
   */
  @IsOptional()
  @IsString()
  @MaxLength(66)
  program?: string;
}
