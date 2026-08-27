export type LabStatus =
  | 'ABSENT'
  | 'CREATING'
  | 'STOPPED'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'PAUSED'
  | 'ERROR';

export interface LabServiceStatusDto {
  name: string;
  state: string;
  running: boolean;
  /**
   * URL publique complète pour ce composant :
   * <GATEWAY_PUBLIC_URL>/apps/<labId>/<composant> (cf.
   * cyber-range-orchestrator/gateway/lab-gateway.ts). Construite par
   * l'orchestrateur, le portail se contente de la relayer.
   */
  url: string;
}

export interface LabStatusResponseDto {
  labId: string | null;
  exists: boolean;
  status: LabStatus;
  services: LabServiceStatusDto[];
}
