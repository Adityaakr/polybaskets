import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class SignedPayloadDto {
  @IsString() ss58: string;
  @IsString() action: 'register' | 'update';
  @IsString() nonce: string;
  @IsString() audience: 'polybaskets.eth';
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsObject() texts?: Record<string, string>;
  @IsOptional() @IsObject() metadata?: Record<string, string>;
  issuedAt: number;
  expiresAt: number;
}

export class SignedRequestDto {
  @ValidateNested()
  @Type(() => SignedPayloadDto)
  payload: SignedPayloadDto;

  @Matches(/^0x[0-9a-fA-F]+$/, { message: 'signature must be 0x-hex' })
  signature: `0x${string}`;
}
