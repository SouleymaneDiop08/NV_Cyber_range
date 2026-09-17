import { EventEmitter } from 'events';
import { ModbusTCPClient } from './client.js';
import type { RawModbusData } from '../types/index.js';

export interface PollerConfig {
  pollIntervalMs: number;
  staleTimeoutMs: number;
  offlineTimeoutMs: number;
}

export class ModbusPoller extends EventEmitter {
  private modbusClient: ModbusTCPClient;
  private config: PollerConfig;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastSuccessAt: number = 0;
  private running = false;

  constructor(modbusClient: ModbusTCPClient, config: PollerConfig) {
    super();
    this.modbusClient = modbusClient;
    this.config = config;

    this.modbusClient.onStateChange((state) => {
      this.emit('connection', state);
      if (state === 'error' || state === 'disconnected') {
        this.emit('offline');
      }
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[Poller] Starting — interval=${this.config.pollIntervalMs}ms`);
    this.modbusClient.connect().catch(() => null);
    this.schedulePoll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.modbusClient.disconnect().catch(() => null);
    console.log('[Poller] Stopped');
  }

  getDataAge(): number {
    return this.lastSuccessAt ? Date.now() - this.lastSuccessAt : Infinity;
  }

  isStale(): boolean {
    return this.getDataAge() > this.config.staleTimeoutMs;
  }

  isOffline(): boolean {
    return this.getDataAge() > this.config.offlineTimeoutMs;
  }

  private schedulePoll(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => this.doPoll(), this.config.pollIntervalMs);
  }

  private async doPoll(): Promise<void> {
    try {
      const raw = await this.modbusClient.pollAll();
      this.lastSuccessAt = Date.now();
      this.emit('data', raw);
    } catch (err) {
      const age = this.getDataAge();
      if (age > this.config.offlineTimeoutMs) {
        this.emit('offline');
      } else if (age > this.config.staleTimeoutMs) {
        this.emit('stale');
      }
      this.emit('error', err);
    } finally {
      this.schedulePoll();
    }
  }
}

// Event declarations for TypeScript
export interface ModbusPoller {
  emit(event: 'data', raw: RawModbusData): boolean;
  emit(event: 'offline'): boolean;
  emit(event: 'stale'): boolean;
  emit(event: 'connection', state: string): boolean;
  emit(event: 'error', err: unknown): boolean;

  on(event: 'data', listener: (raw: RawModbusData) => void): this;
  on(event: 'offline', listener: () => void): this;
  on(event: 'stale', listener: () => void): this;
  on(event: 'connection', listener: (state: string) => void): this;
  on(event: 'error', listener: (err: unknown) => void): this;
}
