import { BadRequestException, ValidationError } from '@nestjs/common';

/**
 * Construit un message de validation lisible, en français, à partir des erreurs
 * de `class-validator`.
 *
 * Par défaut, NestJS renvoie un tableau de messages bruts que le frontend
 * recollait bout à bout — d'où des chaînes du type « email must be an email
 * password must be longer than or equal to 1 characters ». Ici on renvoie une
 * seule phrase correctement formée :
 *
 *   1 erreur   -> la phrase autonome du champ
 *   n erreurs  -> les propositions enchaînées « … , … et … »
 *
 * Chaque règle porte donc deux formulations : `message` (phrase autonome) et
 * `context.clause` (proposition à enchaîner). Quand `context.clause` est absent
 * — cas des DTO déjà rédigés en français — la proposition est dérivée de la
 * phrase, ce qui reste correct dans l'immense majorité des cas.
 */
interface Wording {
  alone: string;
  clause: string;
}

function toClause(sentence: string): string {
  const withoutDot = sentence.trim().replace(/\.$/, '');
  return withoutDot.charAt(0).toLowerCase() + withoutDot.slice(1);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Seul message que `class-validator` produit sans qu'un décorateur puisse le
// personnaliser : il cite le nom technique du champ refusé, ce qui n'apprend
// rien à l'utilisateur. Ce cas ne survient que sur une requête malformée.
const UNKNOWN_FIELD: Wording = {
  alone: 'La requête contient des champs non autorisés.',
  clause: 'la requête contient des champs non autorisés',
};

function collect(errors: ValidationError[], out: Wording[] = []): Wording[] {
  for (const error of errors) {
    if (error.children?.length) {
      collect(error.children, out);
    }
    if (!error.constraints) continue;

    // Une seule règle par champ : un mot de passe absent viole à la fois
    // « chaîne de caractères » et « longueur minimale », mais l'utilisateur n'a
    // besoin que d'une phrase.
    const [key] = Object.keys(error.constraints);
    if (key === 'whitelistValidation') {
      if (!out.some((w) => w.alone === UNKNOWN_FIELD.alone)) {
        out.push(UNKNOWN_FIELD);
      }
      continue;
    }

    const alone = error.constraints[key];
    const context = error.contexts?.[key] as { clause?: string } | undefined;

    out.push({ alone, clause: context?.clause ?? toClause(alone) });
  }
  return out;
}

export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const wordings = collect(errors);

  if (wordings.length === 0) {
    return new BadRequestException('Requête invalide.');
  }
  if (wordings.length === 1) {
    return new BadRequestException(wordings[0].alone);
  }

  const clauses = wordings.map((w) => w.clause);
  const last = clauses.pop() as string;
  const joined =
    clauses.length > 0 ? `${clauses.join(', ')} et ${last}` : `${last}`;

  return new BadRequestException(`${capitalize(joined)}.`);
}
