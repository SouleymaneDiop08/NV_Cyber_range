import { IsString, Length, Matches, MinLength } from 'class-validator';

export class ActivateDto {
  @IsString()
  activationToken!: string;

  @IsString()
  @MinLength(10, {
    message: 'Le mot de passe doit contenir au moins 10 caractères.',
  })
  password!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, {
    message: 'Le code doit contenir exactement 6 chiffres.',
  })
  totpCode!: string;
}
