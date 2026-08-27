/**
 * Token d'injection de la stratégie d'exposition publique des labos. Même rôle
 * que LAB_RUNTIME_DRIVER côté exécution : brancher une autre implémentation
 * (routage par nom d'hôte derrière un reverse-proxy TLS) sans toucher à
 * LabsService, ni au portail, ni aux services du laboratoire.
 */
export const LAB_INGRESS = Symbol('LAB_INGRESS');
