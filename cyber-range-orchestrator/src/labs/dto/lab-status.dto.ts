export type LabAggregateStatus =
  | 'ABSENT'
  | 'STOPPED'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'PAUSED'
  | 'ERROR';

export interface LabServiceStatus {
  name: string;
  state: string;
  running: boolean;
  /**
   * URL publique complète pour ce composant, produite par la stratégie
   * d'exposition en vigueur (cf. ingress/lab-ingress.ts) : une origine dédiée
   * par composant — aujourd'hui un port publié par la gateway, demain un
   * sous-domaine derrière un reverse-proxy TLS.
   *
   * L'orchestrateur possède TOUT le schéma d'URL : le portail se contente de
   * lire cette valeur et ne doit jamais la reconstruire, sans quoi changer de
   * stratégie d'exposition l'obligerait à changer aussi. Vide si le composant
   * n'a pas (ou pas encore) de point d'exposition.
   */
  url: string;
}

export interface LabStatusDto {
  labId: string;
  exists: boolean;
  status: LabAggregateStatus;
  services: LabServiceStatus[];
}
