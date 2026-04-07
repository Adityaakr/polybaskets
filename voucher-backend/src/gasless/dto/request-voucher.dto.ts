import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RequestVoucherDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  account: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  program: string;
}
