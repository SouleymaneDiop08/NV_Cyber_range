import { IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  pendingToken!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, {
    message: 'Le code doit contenir exactement 6 chiffres.',
  })
  totpCode!: string;
}
