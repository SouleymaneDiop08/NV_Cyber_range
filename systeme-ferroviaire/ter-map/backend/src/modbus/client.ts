import ModbusRTU from 'modbus-serial';
import type { RawModbusData } from '../types/index.js';

export interface ModbusClientConfig {
  host: string;
  port: number;
  unitId: number;
  connectTimeoutMs: number;
  reconnectDelayMs: number;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export class ModbusTCPClient {
  private client: ModbusRTU;
  private config: ModbusClientConfig;
  private state: ConnectionState = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private _onStateChange?: (state: ConnectionState) => void;

  constructor(config: ModbusClientConfig) {
    this.config = config;
    this.client = this.createClient();
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  get isConnected(): boolean {
    return this.state === 'connected' && this.client.isOpen;
  }

  onStateChange(cb: (state: ConnectionState) => void): void {
    this._onStateChange = cb;
  }

  private createClient(): ModbusRTU {
    const client = new ModbusRTU();
    client.setTimeout(this.config.connectTimeoutMs);
    return client;
  }

  private setState(s: ConnectionState): void {
    if (this.state !== s) {
      this.state = s;
      this._onStateChange?.(s);
    }
  }

  async connect(): Promise<void> {
    if (this.state === "connecting" || this.state === "connected") return;
    this.setState("connecting");

    try {
      this.client = this.createClient();
      await this.client.connectTCP(this.config.host, { port: this.config.port });
      this.client.setID(this.config.unitId);
      this.setState("connected");
      console.log(`[Modbus] Connected to ${this.config.host}:${this.config.port}`);
    } catch (err) {
      this.setState("error");
      console.error(`[Modbus] Connection failed: ${this.formatError(err)}`);
      this.closeSocket();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.setState('disconnected');
      this.connect().catch(() => null);
    }, this.config.reconnectDelayMs);
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
    this.setState("disconnected");
  }

  private closeSocket(): void {
    try {
      this.client.close(() => null);
    } catch {
      // ignore close errors; the next reconnect creates a fresh client.
    }
  }

  private markBrokenConnection(err: unknown): Error {
    this.closeSocket();
    this.setState("error");
    this.scheduleReconnect();
    const message = this.formatError(err);
    return err instanceof Error ? err : new Error(message);
  }

  private formatError(err: unknown): string {
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === "string") return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  private async modbusOp<T>(op: () => Promise<T>): Promise<T> {
    this.ensureConnected();
    try {
      return await op();
    } catch (err) {
      throw this.markBrokenConnection(err);
    }
  }

  /**
   * Read a batch of Input Registers (FC04) starting at addr, count registers.
   * Returns a map of addr → value.
   */
  async readIR(startAddr: number, count: number): Promise<Record<number, number>> {
    const result = await this.modbusOp(() => this.client.readInputRegisters(startAddr, count));
    const map: Record<number, number> = {};
    for (let i = 0; i < count; i++) {
      map[startAddr + i] = result.data[i] ?? 0;
    }
    return map;
  }

  /**
   * Read a batch of Discrete Inputs (FC02) starting at addr, count bits.
   * Returns a map of addr → boolean.
   */
  async readDI(startAddr: number, count: number): Promise<Record<number, boolean>> {
    const result = await this.modbusOp(() => this.client.readDiscreteInputs(startAddr, count));
    const map: Record<number, boolean> = {};
    for (let i = 0; i < count; i++) {
      map[startAddr + i] = result.data[i] ?? false;
    }
    return map;
  }

  /**
   * Read a batch of coils (FC01) starting at addr, count bits.
   * Used for command coils that are also security-relevant signals.
   */
  async readCoils(startAddr: number, count: number): Promise<Record<number, boolean>> {
    const result = await this.modbusOp(() => this.client.readCoils(startAddr, count));
    const map: Record<number, boolean> = {};
    for (let i = 0; i < count; i++) {
      map[startAddr + i] = result.data[i] ?? false;
    }
    return map;
  }

  /**
   * Full poll: read all registers needed for TER MAP in optimized batches.
   * Returns raw data map + timing metadata.
   */
  async pollAll(): Promise<RawModbusData> {
    const t0 = Date.now();
    this.ensureConnected();

    const ir: Record<number, number> = {};
    const di: Record<number, boolean> = {};
    const coils: Record<number, boolean> = {};

    // Energy + TX temps: IR5..IR10 (6 registers)
    Object.assign(ir, await this.readIR(5, 6));

    // DKR metrics: IR30..IR37 (8 registers)
    Object.assign(ir, await this.readIR(30, 8));

    // DMD metrics: IR40..IR47 (8 registers)
    Object.assign(ir, await this.readIR(40, 8));

    // SIV/SONO consistency metrics: IR60..IR66
    // 60/63 announced positions, 61/64 gaps, 62/65 announced delays, 66 risk level.
    Object.assign(ir, await this.readIR(60, 7));

    // Energy DI: DI4..DI10 (7 bits)
    Object.assign(di, await this.readDI(4, 7));

    // DKR DI: DI11..DI16 (6 bits: PLC_OK, GARE_OK, -, TRAIN_EN_MARCHE, SIGNAL_VERT, SIGNAL_ROUGE)
    Object.assign(di, await this.readDI(11, 6));

    // DKR DI: DI20 (CATENAIRE_OK)
    Object.assign(di, await this.readDI(20, 1));

    // DKR DI: DI26..DI31 (MODE_DEGRADE, -, ALM_CRITIQUE, ALM_TENSION_BASSE, ALM_SURCHARGE, ALM_TRANSFO_CHAUD)
    Object.assign(di, await this.readDI(26, 6));

    // DKR DI: DI37 (ALM_COMMANDE_ANORMALE)
    Object.assign(di, await this.readDI(37, 1));

    // DMD DI: DI39..DI44 (PLC_OK, GARE_OK, -, TRAIN_EN_MARCHE, SIGNAL_VERT, SIGNAL_ROUGE)
    Object.assign(di, await this.readDI(39, 6));

    // DMD DI: DI48 (CATENAIRE_OK)
    Object.assign(di, await this.readDI(48, 1));

    // DMD DI: DI54..DI59 (MODE_DEGRADE, -, -, ALM_CRITIQUE, ALM_TENSION_BASSE, ALM_SURCHARGE)
    Object.assign(di, await this.readDI(54, 6));

    // DMD DI: DI65 (ALM_COMMANDE_ANORMALE)
    Object.assign(di, await this.readDI(65, 1));

    // SIV/SONO alarms + crisis: DI67..DI71 (desinfo DKR/DMD, msg criminel, msg DKR, crise totale)
    Object.assign(di, await this.readDI(67, 5));

    // SIV crisis metrics: IR68 (msg_niveau), IR69 (dkr_msg_actif)
    Object.assign(ir, await this.readIR(68, 2));

    // CTC switch metrics: IR70 (distance), IR71 (risk level), IR72 (impact point)
    Object.assign(ir, await this.readIR(70, 3));

    // CTC alarms: DI72 (aiguille_deviee), DI73 (alm_aiguille), DI74 (alm_collision)
    Object.assign(di, await this.readDI(72, 3));

    // CTC attack command: coil32 (%QX4.0). This is the actual value written by FC05.
    Object.assign(coils, await this.readCoils(32, 1));

    return {
      ir,
      di,
      coils,
      read_at: new Date().toISOString(),
      latency_ms: Date.now() - t0,
    };
  }

  /**
   * Write a single Holding Register (FC06) at addr with value.
   */
  async writeHR(addr: number, value: number): Promise<void> {
    await this.modbusOp(() => this.client.writeRegister(addr, value));
  }

  /**
   * Write a single Coil (FC05) at addr with boolean value.
   */
  async writeCoil(addr: number, value: boolean): Promise<void> {
    await this.modbusOp(() => this.client.writeCoil(addr, value));
  }

  /**
   * Read a batch of Holding Registers (FC03) starting at addr.
   * Returns a map of addr → value.
   */
  async readHR(startAddr: number, count: number): Promise<Record<number, number>> {
    const result = await this.modbusOp(() => this.client.readHoldingRegisters(startAddr, count));
    const map: Record<number, number> = {};
    for (let i = 0; i < count; i++) {
      map[startAddr + i] = result.data[i] ?? 0;
    }
    return map;
  }

  private ensureConnected(): void {
    if (!this.isConnected) {
      // Trigger reconnect for next cycle
      if (this.state !== 'connecting') {
        this.scheduleReconnect();
      }
      throw new Error(`Modbus not connected (state=${this.state})`);
    }
  }
}
