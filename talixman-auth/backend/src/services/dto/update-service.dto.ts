import { AccessLevel, ServiceCategory } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateServiceDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  labComponent?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsEnum(AccessLevel)
  @IsOptional()
  accessLevel?: AccessLevel;

  @IsEnum(ServiceCategory)
  @IsOptional()
  category?: ServiceCategory;

  @IsString()
  @IsOptional()
  ssoTarget?: string;
}
