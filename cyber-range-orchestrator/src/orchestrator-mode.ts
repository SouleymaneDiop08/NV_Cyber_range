/**
 * Découpage du middleware en deux rôles déployables séparément, à partir de la
 * MÊME image. Motivation (sécurité) : le plan de contrôle monte le socket
 * Docker de l'hôte — un accès équivalent à root — tandis que la gateway est la
 * seule surface HTTP publique (un navigateur ne peut pas présenter le token de
 * service). Les cumuler dans un seul processus signifie qu'une RCE dans la
 * chaîne de proxy donne root sur l'hôte ; les séparer supprime ce cumul.
 *
 * - `control`  : API `/labs/*` + `/templates/*` (token requis), socket Docker
 *                monté, AUCUN port publié — joignable seulement par le portail.
 * - `gateway`  : proxy public `/apps/*` uniquement, AUCUN socket Docker, état
 *                des labos lu en lecture seule. Ne connaît même pas le token
 *                de service.
 * - `all`      : les deux dans un seul processus. Pratique en développement,
 *                déconseillé en production (c'est exactement le cumul ci-dessus).
 */
export type OrchestratorMode = 'control' | 'gateway' | 'all';

const MODES: readonly OrchestratorMode[] = ['control', 'gateway', 'all'];

export function resolveOrchestratorMode(
  raw: string | undefined,
): OrchestratorMode {
  const value = (raw ?? 'all').trim().toLowerCase();
  if (!MODES.includes(value as OrchestratorMode)) {
    throw new Error(
      `ORCHESTRATOR_MODE invalide : « ${raw} ». Valeurs acceptées : ${MODES.join(' | ')}.`,
    );
  }
  return value as OrchestratorMode;
}

/** Le plan de contrôle (API token-protégée + pilotage Docker) est-il actif ? */
export function servesControlApi(mode: OrchestratorMode): boolean {
  return mode === 'control' || mode === 'all';
}

/** La gateway HTTP/WebSocket publique est-elle active ? */
export function servesGateway(mode: OrchestratorMode): boolean {
  return mode === 'gateway' || mode === 'all';
}
