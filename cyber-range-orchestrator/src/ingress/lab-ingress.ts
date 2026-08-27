/**
 * Point d'exposition public d'UN composant de labo. Volontairement ouvert :
 * chaque stratégie n'en remplit que ce qui la concerne (`port` aujourd'hui,
 * `host` avec un routage par nom d'hôte). Le portail ne lit jamais cette
 * structure — il ne voit que l'URL finale rendue par `urlFor()`.
 */
export interface IngressBinding {
  /** Stratégie « un port par composant » : port publié par la gateway. */
  port?: number;
  /** Stratégie « nom d'hôte » : FQDN routé par la gateway sur un port unique. */
  host?: string;
}

/** Composant (clé de lab-components.json) -> son point d'exposition. */
export type IngressBindings = Record<string, IngressBinding>;

/** Ce qui est persisté dans l'état d'un labo, aux côtés de son template. */
export interface IngressAllocation {
  /** Stratégie ayant produit ces liaisons — permet de détecter un changement. */
  strategy: string;
  bindings: IngressBindings;
}

/**
 * Contrat d'exposition publique d'un labo, indépendant de la mécanique
 * concrète — pendant, côté réseau, de `LabRuntimeDriver` côté exécution.
 *
 * Raison d'être : les applications du laboratoire (FUXA, OpenPLC, viewer 3D)
 * fabriquent toutes leurs URLs À LA RACINE (`<base href="/">`, `Location:
 * /login`, appels `/api/...`). Les servir sous un préfixe de chemin est donc
 * impossible sans les modifier — ce qu'on s'interdit. Chaque composant doit
 * recevoir sa PROPRE ORIGINE.
 *
 * Deux stratégies répondent à ce besoin :
 * - `PortIngress` (v1) : une origine = un port publié par la gateway ;
 * - un futur `HostnameIngress` : une origine = un sous-domaine, routé par
 *   en-tête `Host` sur un port unique derrière un reverse-proxy TLS.
 *
 * Passer de l'une à l'autre ne doit toucher NI le portail (qui se contente de
 * relayer `services[].url`), NI les services du labo. C'est tout l'objet de
 * cette interface : l'orchestrateur reste le seul détenteur du schéma d'URL.
 */
export interface LabIngress {
  /** Identifiant de la stratégie, persisté avec l'allocation. */
  readonly strategy: string;

  /**
   * Réserve les points d'exposition d'un labo.
   * @param labId    labo concerné
   * @param componentKeys composants à exposer (clés de lab-components.json)
   * @param taken    allocations des AUTRES labos, pour éviter les collisions
   */
  allocate(
    labId: string,
    componentKeys: string[],
    taken: IngressAllocation[],
  ): IngressAllocation;

  /** URL publique d'un composant à partir de sa liaison. */
  urlFor(binding: IngressBinding): string;
}
