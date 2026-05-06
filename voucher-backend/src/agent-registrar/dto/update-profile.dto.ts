import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ProfileDto } from './profile.dto';

export class UpdateProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(66)
  account: string;

  @ValidateNested()
  @Type(() => ProfileDto)
  profile: ProfileDto;
}
