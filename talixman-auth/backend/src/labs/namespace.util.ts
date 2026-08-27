import { createHash } from 'crypto';

/**
 * Identifiant de labo déterministe pour un ADMIN — calculé côté portail (le
 * seul détenteur de la contrainte d'unicité `Lab.ownerId`), l'orchestrateur ne
 * fait qu'exécuter la chaîne qu'on lui donne (Docker Compose Project Name).
 * `lab-` + 12 hex du sha256 de l'UUID de l'admin : déterministe (create-or-get
 * idempotent), compatible avec les contraintes de nommage Compose
 * (minuscules/chiffres/tirets), sans risque de collision inter-secteurs
 * (dérivé d'un UUID globalement unique, pas d'un identifiant scopé au secteur).
 */
export function namespaceForOwner(ownerId: string): string {
  const hash = createHash('sha256').update(ownerId).digest('hex').slice(0, 12);
  return `lab-${hash}`;
}
