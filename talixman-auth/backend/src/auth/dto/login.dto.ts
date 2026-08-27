import { IsEmail, IsString, MinLength } from 'class-validator';

// Deux formulations : `message` quand l'erreur est seule, `context.clause`
// quand elle doit s'enchaîner à une autre (cf. validationExceptionFactory).
const PASSWORD_REQUIRED = {
  message: 'Le mot de passe est requis.',
  context: { clause: 'le champ du mot de passe est requis' },
};

export class LoginDto {
  @IsEmail(
    {},
    {
      message: "L'adresse email saisie n'est pas au bon format.",
      context: { clause: "l'adresse email n'est pas valide" },
    },
  )
  email!: string;

  // Les deux règles portent le même libellé : que le champ soit absent ou vide,
  // l'utilisateur doit lire la même chose.
  @IsString(PASSWORD_REQUIRED)
  @MinLength(1, PASSWORD_REQUIRED)
  password!: string;
}
