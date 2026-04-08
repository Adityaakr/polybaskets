import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RequestVoucherDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(66) // 0x + 64 hex chars (Vara address)
  account: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(66)
  program: string;
}
