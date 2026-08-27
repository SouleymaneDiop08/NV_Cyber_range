/**
 * Token d'injection du runtime de labo. Permet de brancher une autre
 * implémentation de `LabRuntimeDriver` (ex. un driver `runc` pour tester sans
 * KVM, ou un futur runtime) sans toucher à LabsService.
 */
export const LAB_RUNTIME_DRIVER = Symbol('LAB_RUNTIME_DRIVER');
