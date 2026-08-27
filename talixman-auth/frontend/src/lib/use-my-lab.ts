import { useQuery } from '@tanstack/react-query';
import { getMyLab, type LabStatus } from './api';

export const LAB_QUERY_KEY = ['labs', 'me'];

const TRANSITIONAL_STATUSES: LabStatus[] = ['CREATING', 'STARTING', 'STOPPING'];

/** Suivi rapproché d'une transition en cours, pour que la bascule paraisse immédiate. */
const TRANSITION_POLL_MS = 3_000;
/**
 * Sondage de fond, y compris sur un statut stable.
 *
 * Indispensable pour les GUEST : le labo qu'ils consultent appartient à leur
 * ADMIN, et c'est lui qui le démarre ou l'arrête. Sans ce sondage, un invité
 * resté sur un `RUNNING` n'apprenait l'arrêt qu'en rechargeant la page — les
 * cartes de service restaient cliquables dans le vide. L'ADMIN, lui, ne voyait
 * pas le problème : ses propres mutations invalident le cache.
 *
 * Chaque appel déclenche un `docker exec … compose ps` côté orchestrateur,
 * d'où un intervalle volontairement lâche.
 */
const IDLE_POLL_MS = 10_000;

/**
 * Source unique du statut du labo. Utilisée à la fois par `LabCard` et par
 * `PortailPage` : même clé, donc même entrée de cache et une seule requête
 * réseau — mais surtout, même politique de rafraîchissement. Auparavant seul
 * `LabCard` portait un `refetchInterval`, ce qui rendait la fraîcheur du
 * portail dépendante du montage d'un autre composant.
 */
export function useMyLab() {
  return useQuery({
    queryKey: LAB_QUERY_KEY,
    queryFn: getMyLab,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TRANSITIONAL_STATUSES.includes(status)
        ? TRANSITION_POLL_MS
        : IDLE_POLL_MS;
    },
    // Le défaut global est `false` (cf. main.tsx). Ici on le réactive : au
    // retour sur l'onglet, l'état doit être à jour sans attendre le prochain
    // tick.
    refetchOnWindowFocus: true,
  });
}
