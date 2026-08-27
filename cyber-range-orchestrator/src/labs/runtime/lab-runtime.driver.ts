/**
 * Métadonnées d'un template de labo, lues depuis `<template>/lab-template.json`
 * (cf. dispatching/lab-template.json). Le middleware n'a aucune connaissance en
 * dur d'un secteur/template : ajouter un template = déposer un dossier avec son
 * `lab-template.json` + `lab-components.json` + son image de labo, jamais
 * toucher au code de l'orchestrateur.
 */
export interface LabTemplate {
  /**
   * Image auto-suffisante du labo (démon Docker + compose + images
   * pré-buildées), ex. `talixman-lab-dispatching:latest`. Le runtime concret
   * (DinD, et demain Kata) décide comment l'exécuter ; le template ne décrit
   * que QUOI exécuter.
   */
  labImage: string;
  /** Profil Docker Compose activé DANS le labo (ex. `test` | `core` | `full`). */
  composeProfile: string;
  /** Chemin du docker-compose.yml À L'INTÉRIEUR du labo (pour `compose ps`). */
  composeFile: string;
  /**
   * Runtime souhaité par ce template (`dind` aujourd'hui). Indicatif : le
   * runtime réellement utilisé reste choisi par la configuration de
   * l'orchestrateur (`LAB_RUNTIME`), ce champ sert à documenter le template et
   * à permettre plus tard un template exigeant un runtime particulier.
   */
  runtime?: string;
}

/** État brut d'un composant (service Compose) tel que vu dans le labo. */
export interface LabComponentState {
  /** Nom du service Compose (à corréler avec lab-components.json -> service). */
  service: string;
  /** État Compose brut : `running` | `exited` | `paused` | `dead` | `created` | … */
  state: string;
}

/**
 * État de l'instance du labo côté hôte — le conteneur DinD aujourd'hui, la
 * mini-VM avec un futur runtime Kata. Volontairement neutre : c'est le contrat
 * commun à tous les runtimes.
 */
export type LabInstanceState = 'absent' | 'running' | 'paused' | 'exited';

export interface LabInspection {
  instance: LabInstanceState;
  /**
   * Composants internes — vide si l'instance n'est pas `running` ou pas encore
   * prête (démon interne en cours de démarrage).
   */
  components: LabComponentState[];
}

/**
 * Contrat d'exécution d'un labo, indépendant du runtime concret
 * (`DindComposeDriver` en v1, `KataComposeDriver` conservé pour la cible long
 * terme). Toute la logique métier de `LabsService` passe par cette interface :
 * remplacer ou ajouter un runtime ne touche ni au service, ni au portail, ni
 * au frontend.
 */
export interface LabRuntimeDriver {
  /** Crée et démarre l'instance du labo (idempotence gérée par l'appelant). */
  create(labId: string, template: LabTemplate): Promise<void>;
  /** (Re)démarre une instance arrêtée — l'entrypoint relance le compose au boot. */
  start(labId: string): Promise<void>;
  /** Arrête l'instance (état conservé, redémarrable). */
  stop(labId: string): Promise<void>;
  /** Gèle l'instance (suspension). */
  pause(labId: string): Promise<void>;
  /** Dégèle l'instance (reprise). */
  resume(labId: string): Promise<void>;
  /** Détruit l'instance et ses ressources (best-effort, idempotent). */
  delete(labId: string): Promise<void>;
  /** L'instance existe-t-elle encore côté hôte ? */
  exists(labId: string): Promise<boolean>;
  /** État de l'instance + de ses composants internes. */
  inspect(labId: string, template: LabTemplate): Promise<LabInspection>;
}
