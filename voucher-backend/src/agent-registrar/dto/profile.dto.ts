import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ProfileAddressDto {
  @IsString()
  @MaxLength(64)
  chain: string;

  @IsString()
  @MaxLength(256)
  value: string;
}

export class ProfileDto {
  /**
   * ENSIP-5 text records, free-form. Vocabulary not enforced — agents can
   * use any standard key (description, avatar, url) or namespaced social
   * key (com.twitter, com.github). Format validation only.
   */
  @IsOptional()
  @IsObject()
  texts?: Record<string, string | null>;

  /** ENSIP-9 multichain addresses. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProfileAddressDto)
  addresses?: ProfileAddressDto[];

  /**
   * Convenience for the most common case — surfaced in STARTER_PROMPT so an
   * agent can supply its EVM address without learning the addresses[] shape.
   * Mapped into addresses[] as { chain: 'Ethereum', value } during processing.
   */
  @IsOptional()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, { message: 'ethAddress must be 0x + 40 hex' })
  ethAddress?: string;
}
