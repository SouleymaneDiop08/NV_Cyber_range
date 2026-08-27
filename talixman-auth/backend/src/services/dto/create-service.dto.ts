import { AccessLevel, ServiceCategory } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  labComponent!: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsEnum(AccessLevel)
  accessLevel!: AccessLevel;

  @IsEnum(ServiceCategory)
  @IsOptional()
  category?: ServiceCategory;

  @IsString()
  @IsOptional()
  ssoTarget?: string;
}
