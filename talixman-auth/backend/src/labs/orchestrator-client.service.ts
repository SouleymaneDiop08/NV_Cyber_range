import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LabStatusResponseDto } from './dto/lab-status.dto';

/**
 * Client HTTP vers cyber-range-orchestrator — le seul point de contact du
 * portail avec Docker (indirect : jamais de socket Docker ici, uniquement des
 * appels REST). Les erreurs ici REMONTENT
 * toujours : la cohérence du cycle de vie d'un labo est le cœur de cette
 * fonctionnalité, un échec d'orchestration ne doit jamais être avalé.
 */
@Injectable()
export class OrchestratorClientService {
  private readonly logger = new Logger(OrchestratorClientService.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.getOrThrow<string>('LABS_ORCHESTRATOR_URL');
    this.token = this.config.getOrThrow<string>('ORCHESTRATOR_SERVICE_TOKEN');
  }

  private async call(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      this.logger.error(
        `cyber-range-orchestrator injoignable (${method} ${path})`,
        err,
      );
      throw new ServiceUnavailableException(
        "Le service d'orchestration des laboratoires est indisponible.",
      );
    }
    if (!res.ok) {
      this.logger.error(
        `cyber-range-orchestrator: ${method} ${path} -> HTTP ${res.status}`,
      );
      throw new ServiceUnavailableException(
        `Le service d'orchestration a renvoyé une erreur (HTTP ${res.status}).`,
      );
    }
    return res;
  }

  async createOrGet(
    labId: string,
    template: string,
  ): Promise<LabStatusResponseDto> {
    const res = await this.call('PUT', `/labs/${labId}`, { template });
    return res.json() as Promise<LabStatusResponseDto>;
  }

  async start(labId: string): Promise<LabStatusResponseDto> {
    const res = await this.call('POST', `/labs/${labId}/start`);
    return res.json() as Promise<LabStatusResponseDto>;
  }

  async stop(labId: string): Promise<LabStatusResponseDto> {
    const res = await this.call('POST', `/labs/${labId}/stop`);
    return res.json() as Promise<LabStatusResponseDto>;
  }

  async pause(labId: string): Promise<LabStatusResponseDto> {
    const res = await this.call('POST', `/labs/${labId}/pause`);
    return res.json() as Promise<LabStatusResponseDto>;
  }

  async resume(labId: string): Promise<LabStatusResponseDto> {
    const res = await this.call('POST', `/labs/${labId}/resume`);
    return res.json() as Promise<LabStatusResponseDto>;
  }

  async getStatus(labId: string): Promise<LabStatusResponseDto> {
    const res = await this.call('GET', `/labs/${labId}`);
    return res.json() as Promise<LabStatusResponseDto>;
  }

  async delete(labId: string): Promise<void> {
    await this.call('DELETE', `/labs/${labId}`);
  }

  /** Composants disponibles pour un template de labo (menu déroulant SUPERADMIN). */
  async getTemplateServices(
    template: string,
  ): Promise<Array<{ key: string; label: string }>> {
    const res = await this.call('GET', `/templates/${template}/services`);
    return res.json() as Promise<Array<{ key: string; label: string }>>;
  }
}
