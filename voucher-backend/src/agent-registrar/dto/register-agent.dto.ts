import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProfileDto } from './profile.dto';

export class RegisterAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(66)
  account: string;

  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'name must be lowercase letters, digits, hyphens (3-20 chars)',
  })
  name: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileDto)
  profile?: ProfileDto;
}
