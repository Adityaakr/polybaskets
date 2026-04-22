import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
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
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(66, { each: true })
  programs: string[];
}
