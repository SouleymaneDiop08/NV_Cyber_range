import { IsString, Length, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  resetToken!: string;

  @IsString()
  @MinLength(10, {
    message: 'Le mot de passe doit contenir au moins 10 caractères.',
  })
  password!: string;

  // Le lien reçu par email ne suffit pas : le second facteur reste exigé, sans
  // quoi l'accès à la boîte mail suffirait à prendre le compte.
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, {
    message: 'Le code doit contenir exactement 6 chiffres.',
  })
  totpCode!: string;
}
