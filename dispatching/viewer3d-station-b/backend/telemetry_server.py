#!/usr/bin/env python3
"""
Telemetry Server for Station B 3D Viewer
=========================================
READ-ONLY Modbus TCP client serving WebSocket data for 3D visualization.

SECURITY: This server performs NO WRITE operations to the PLC.
All Modbus connections use read-only function codes (01, 02, 03, 04).

Architecture:
- Connects to PLC via Modbus TCP (read-only)
- Serves real-time telemetry via WebSocket to frontend
- Also serves static files for the 3D viewer

Usage:
    python telemetry_server.py [--host 0.0.0.0] [--port 8090] [--plc-host 192.168.20.10]
"""

import asyncio
import json
import logging
import os
import argparse
import contextlib
from datetime import datetime
from typing import Dict, Any, Optional, Set, Callable, Awaitable

from aiohttp import web
import aiohttp

# Import mapping (local module)
from modbus_mapping import (
    PLC_HOST, PLC_PORT,
    COILS, DISCRETE_INPUTS, INPUT_REGISTERS, HOLDING_REGISTERS, OUTPUT_REGISTERS
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("telemetry_server")

# Try to import pymodbus
try:
    from pymodbus.client import AsyncModbusTcpClient
    from pymodbus.exceptions import ModbusException
    PYMODBUS_AVAILABLE = True
except ImportError:
    logger.warning("pymodbus not installed - live PLC telemetry unavailable")
    PYMODBUS_AVAILABLE = False


class TelemetryCollector:
    """
    Collects telemetry from PLC via Modbus TCP (READ-ONLY).
    If PLC is unreachable, keeps the last good snapshot frozen and marks data as disconnected.
    """

    def __init__(self, plc_host: str = PLC_HOST, plc_port: int = PLC_PORT):
        self.plc_host = plc_host
        self.plc_port = plc_port
        self.client: Optional[AsyncModbusTcpClient] = None
        self.connected = False
        self.last_data: Dict[str, Any] = {}
        self.last_live_data: Dict[str, Any] = {}
        self.reconnect_interval = 2.0
        self._last_connect_attempt = 0.0
        self._connect_lock = asyncio.Lock()
        self.data_source = "disconnected"

    async def connect(self) -> bool:
        """Establish connection to PLC (if pymodbus available)."""
        if not PYMODBUS_AVAILABLE:
            self.data_source = "disconnected"
            logger.warning("pymodbus unavailable - PLC telemetry disabled")
            return False

        async with self._connect_lock:
            if self.connected and self.client:
                return True

            if self.client:
                with contextlib.suppress(Exception):
                    self.client.close()
                self.client = None

            try:
                self.client = AsyncModbusTcpClient(
                    host=self.plc_host,
                    port=self.plc_port,
                    timeout=3
                )
                self.connected = await self.client.connect()
                if self.connected:
                    self.data_source = "openplc-modbus"
                    logger.info(f"Connected to PLC at {self.plc_host}:{self.plc_port}")
                else:
                    self.data_source = "disconnected"
                    logger.warning(f"Could not connect to PLC at {self.plc_host}:{self.plc_port}")
                return self.connected
            except Exception as e:
                logger.error(f"Connection error: {e}")
                self.connected = False
                self.data_source = "disconnected"
                return False

    async def disconnect(self):
        """Close connection to PLC."""
        if self.client:
            with contextlib.suppress(Exception):
                self.client.close()
        if self.connected:
            logger.info("Disconnected from PLC")
        self.client = None
        self.connected = False
        self.data_source = "disconnected"

    async def ensure_connection(self) -> bool:
        """Reconnect automatically if the PLC became available after startup."""
        if self.connected and self.client:
            return True
        return await self.connect()

    async def read_coils(self) -> Dict[str, bool]:
        """Read coil status (Function 01) - READ ONLY."""
        result = {}
        if not self.connected or not self.client:
            return result

        try:
            response = await self.client.read_coils(address=0, count=16)
            if not response.isError():
                for name, config in COILS.items():
                    addr = config["address"]
                    if addr < len(response.bits):
                        result[name] = response.bits[addr]
            else:
                logger.warning(f"Error reading coils: {response}")
        except Exception as e:
            logger.error(f"Exception reading coils: {e}")
            await self.disconnect()
        return result

    async def read_discrete_inputs(self) -> Dict[str, bool]:
        """Read discrete inputs (Function 02) - READ ONLY."""
        result = {}
        if not self.connected or not self.client:
            return result

        try:
            # OpenPLC repond plus proprement si la lecture est faite sur une plage unique.
            start, count = 0, 32
            response = await self.client.read_discrete_inputs(address=start, count=count)
            if not response.isError():
                for name, config in DISCRETE_INPUTS.items():
                    addr = config["address"]
                    if start <= addr < start + count:
                        idx = addr - start
                        if idx < len(response.bits):
                            result[name] = response.bits[idx]
            else:
                logger.warning(f"Error reading discrete inputs: {response}")
        except Exception as e:
            logger.error(f"Exception reading discrete inputs: {e}")
        return result

    async def read_input_registers(self) -> Dict[str, int]:
        """Read input registers (Function 04) - READ ONLY."""
        result = {}
        if not self.connected or not self.client:
            return result

        try:
            for start, count in [(0, 16), (20, 16), (30, 8)]:
                response = await self.client.read_input_registers(address=start, count=count)
                if not response.isError():
                    for name, config in INPUT_REGISTERS.items():
                        addr = config["address"]
                        if start <= addr < start + count:
                            idx = addr - start
                            if idx < len(response.registers):
                                result[name] = response.registers[idx]
        except Exception as e:
            logger.error(f"Exception reading input registers: {e}")
            await self.disconnect()
        return result

    async def read_holding_registers(self) -> Dict[str, int]:
        """Read holding/output registers (Function 03) - READ ONLY."""
        result = {}
        if not self.connected or not self.client:
            return result

        try:
            # Standard setpoints (OpenPLC %MW0/%MW1 = Modbus addr 1024/1025) and
            # feeder currents on %QW (Modbus addr 20-37 for output registers).
            for start, count in [(1024, 4), (20, 16), (30, 8)]:
                response = await self.client.read_holding_registers(address=start, count=count)
                if not response.isError():
                    for name, config in HOLDING_REGISTERS.items():
                        addr = config["address"]
                        if start <= addr < start + count:
                            idx = addr - start
                            if idx < len(response.registers):
                                result[name] = response.registers[idx]
                    for name, config in OUTPUT_REGISTERS.items():
                        addr = config["address"]
                        if start <= addr < start + count:
                            idx = addr - start
                            if idx < len(response.registers):
                                result[name] = response.registers[idx]
            # Stuxnet hidden registers: real TX2 state at %MW100-103.
            # OpenPLC maps %MW at Modbus address MIN_16B_RANGE + offset = 1024 + N.
            # MW100 = Modbus holding register 1124, MW101=1125, MW102=1126, MW103=1127.
            stuxnet_response = await self.client.read_holding_registers(address=1124, count=4)
            if not stuxnet_response.isError() and len(stuxnet_response.registers) >= 4:
                result["REAL_TX2_OilTemp"]     = stuxnet_response.registers[0]
                result["REAL_TX2_WindingTemp"] = stuxnet_response.registers[1]
                result["REAL_TX2_ALM_High"]    = stuxnet_response.registers[2]
                result["REAL_TX2_ALM_Crit"]    = stuxnet_response.registers[3]
        except Exception as e:
            logger.error(f"Exception reading holding registers: {e}")
        return result

    def _build_structured_data(
        self,
        coils: Dict[str, bool],
        discrete_inputs: Dict[str, bool],
        input_registers: Dict[str, int],
        holding_registers: Dict[str, int],
        stale: bool,
    ) -> Dict[str, Any]:
        tx1_setpoint = holding_registers.get("SET_TX1_Voltage", 0) or input_registers.get("MET_TX1_Output_Voltage", 0)
        tx2_setpoint = holding_registers.get("SET_TX2_Voltage", 0) or input_registers.get("MET_TX2_Output_Voltage", 0)

        return {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "connected": self.connected,
            "simulation": False,
            "stale": stale,
            "source": self.data_source,
            "breakers": {
                "main_cb": coils.get("CMD_CB_Toggle", False),
                "line_ds": coils.get("CMD_DS_Line_Toggle", False),
                "bus_ds": coils.get("CMD_DS_Bus_Toggle", False),
                "tx1_cb": coils.get("CMD_TX1_CB_Toggle", False),
                "tx1_ds": coils.get("CMD_TX1_DS_Bus_Toggle", False),
                "tx2_cb": coils.get("CMD_TX2_CB_Toggle", False),
                "tx2_ds": coils.get("CMD_TX2_DS_Bus_Toggle", False),
                "feeder1_cb": coils.get("CMD_Feeder1_CB", False),
                "feeder2_cb": coils.get("CMD_Feeder2_CB", False),
            },
            "busbar": {
                "live": discrete_inputs.get("STS_Busbar_Live", False),
                "voltage": input_registers.get("MET_Bus_Voltage", 0),
            },
            "grid": {
                "frequency": input_registers.get("MET_Freq", 0),
                "voltage": input_registers.get("MET_L1_Voltage", 0),
                "current": input_registers.get("MET_L1_Current", 0),
                "power": input_registers.get("MET_L1_Power", 0),
            },
            "transformer1": {
                "cb_closed": coils.get("CMD_TX1_CB_Toggle", False),
                "output_voltage": input_registers.get("MET_TX1_Output_Voltage", 0),
                "setpoint": tx1_setpoint,
                "oil_temp": input_registers.get("MET_TX1_OilTemp", 0),
                "winding_temp": input_registers.get("MET_TX1_WindingTemp", 0),
                "alarm_high": discrete_inputs.get("ALM_TX1_Temp_High", False),
                "alarm_critical": discrete_inputs.get("ALM_TX1_Temp_Crit", False),
            },
            "transformer2": {
                "cb_closed": coils.get("CMD_TX2_CB_Toggle", False),
                "output_voltage": input_registers.get("MET_TX2_Output_Voltage", 0),
                "setpoint": tx2_setpoint,
                # Use real (hidden) registers when present — Stuxnet scenario:
                # FUXA reads %IW10/%IW11 (frozen at normal values);
                # viewer reads %MW100/%MW101 (true overheating simulation).
                "oil_temp": holding_registers.get("REAL_TX2_OilTemp",
                            input_registers.get("MET_TX2_OilTemp", 0)),
                "winding_temp": holding_registers.get("REAL_TX2_WindingTemp",
                                input_registers.get("MET_TX2_WindingTemp", 0)),
                "alarm_high": bool(holding_registers.get("REAL_TX2_ALM_High",
                              discrete_inputs.get("ALM_TX2_Temp_High", False))),
                "alarm_critical": bool(holding_registers.get("REAL_TX2_ALM_Crit",
                                  discrete_inputs.get("ALM_TX2_Temp_Crit", False))),
            },
            "feeder1": {
                "cb_closed": coils.get("CMD_Feeder1_CB", False),
                "i1": holding_registers.get("MET_Fdr1_I1", input_registers.get("MET_Fdr1_I1", 0)),
                "i2": holding_registers.get("MET_Fdr1_I2", input_registers.get("MET_Fdr1_I2", 0)),
                "i3": holding_registers.get("MET_Fdr1_I3", input_registers.get("MET_Fdr1_I3", 0)),
                "imax": holding_registers.get("CALC_Fdr1_Imax") or input_registers.get("CALC_Fdr1_Imax", 0),
                "imoy": input_registers.get("CALC_Fdr1_Imoy", 0),
                "unbalance": input_registers.get("CALC_Fdr1_Unbalance", 0),
                "alarm_overload": discrete_inputs.get("ALM_Fdr1_Surcharge", False),
                "alarm_imbalance": discrete_inputs.get("ALM_Fdr1_Desequilibre", False),
                "alarm_incoherence": discrete_inputs.get("ALM_Fdr1_Incoherence", False),
            },
            "feeder2": {
                "cb_closed": coils.get("CMD_Feeder2_CB", False),
                "i1": holding_registers.get("MET_Fdr2_I1", input_registers.get("MET_Fdr2_I1", 0)),
                "i2": holding_registers.get("MET_Fdr2_I2", input_registers.get("MET_Fdr2_I2", 0)),
                "i3": holding_registers.get("MET_Fdr2_I3", input_registers.get("MET_Fdr2_I3", 0)),
                "imax": holding_registers.get("CALC_Fdr2_Imax", input_registers.get("CALC_Fdr2_Imax", 0)),
                "imoy": input_registers.get("CALC_Fdr2_Imoy", 0),
                "unbalance": input_registers.get("CALC_Fdr2_Unbalance", 0),
                "alarm_overload": discrete_inputs.get("ALM_Fdr2_Surcharge", False),
                "alarm_imbalance": discrete_inputs.get("ALM_Fdr2_Desequilibre", False),
                "alarm_incoherence": discrete_inputs.get("ALM_Fdr2_Incoherence", False),
            },
        }

    async def collect_all(self) -> Dict[str, Any]:
        """Collect all telemetry data (READ ONLY)."""
        await self.ensure_connection()

        if self.connected and self.client:
            coils = await self.read_coils()
            discrete_inputs = await self.read_discrete_inputs()
            input_registers = await self.read_input_registers()
            holding_registers = await self.read_holding_registers()

            if self.connected and input_registers:
                data = self._build_structured_data(
                    coils=coils,
                    discrete_inputs=discrete_inputs,
                    input_registers=input_registers,
                    holding_registers=holding_registers,
                    stale=False,
                )
                self.last_data = data
                self.last_live_data = dict(data)
                return data

        if self.last_live_data:
            frozen = dict(self.last_live_data)
            frozen["timestamp"] = datetime.utcnow().isoformat() + "Z"
            frozen["connected"] = False
            frozen["simulation"] = False
            frozen["stale"] = True
            frozen["source"] = "frozen-last-good-snapshot"
            return frozen

        empty = self._build_structured_data({}, {}, {}, {}, stale=True)
        empty["connected"] = False
        empty["source"] = "no-data"
        return empty


# ============================================================================
# Web Server
# ============================================================================

class TelemetryServer:
    """Web server for 3D viewer with WebSocket telemetry."""

    def __init__(self, host: str, port: int, plc_host: str, plc_port: int, static_path: str):
        self.host = host
        self.port = port
        self.static_path = static_path
        self.collector = TelemetryCollector(plc_host=plc_host, plc_port=plc_port)
        self.websockets: Set[web.WebSocketResponse] = set()
        self.app = web.Application()
        self._setup_routes()

    def _setup_routes(self):
        """Configure HTTP routes."""
        self.app.router.add_get("/", self.index_handler)
        self.app.router.add_get("/api/status", self.status_handler)
        self.app.router.add_get("/api/telemetry", self.telemetry_handler)
        self.app.router.add_get("/ws", self.websocket_handler)
        self.app.router.add_static("/static", self.static_path)

    async def index_handler(self, request: web.Request) -> web.Response:
        """Serve index.html."""
        index_path = os.path.join(self.static_path, "index.html")
        if os.path.exists(index_path):
            return web.FileResponse(index_path)
        return web.Response(text="Station B 3D Viewer - index.html not found", status=404)

    async def status_handler(self, request: web.Request) -> web.Response:
        """Return server status."""
        await self.collector.collect_all()
        mode = "live" if self.collector.connected else "disconnected"
        source = self.collector.data_source if self.collector.connected else (
            "frozen-last-good-snapshot" if self.collector.last_live_data else "no-data"
        )
        return web.json_response({
            "status": "running",
            "plc_connected": self.collector.connected,
            "websocket_clients": len(self.websockets),
            "mode": mode,
            "source": source,
            "plc_target": f"{self.collector.plc_host}:{self.collector.plc_port}",
            "last_snapshot_available": bool(self.collector.last_live_data),
        })

    async def telemetry_handler(self, request: web.Request) -> web.Response:
        """Return current telemetry (REST endpoint)."""
        data = await self.collector.collect_all()
        return web.json_response(data)

    async def websocket_handler(self, request: web.Request) -> web.WebSocketResponse:
        """WebSocket endpoint for real-time telemetry."""
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.websockets.add(ws)
        logger.info(f"WebSocket client connected (total: {len(self.websockets)})")

        try:
            # Send initial data
            data = await self.collector.collect_all()
            await ws.send_json(data)

            # Keep connection open
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    # Client can send 'ping' to keep alive
                    if msg.data == "ping":
                        await ws.send_str("pong")
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(f"WebSocket error: {ws.exception()}")
        finally:
            self.websockets.discard(ws)
            logger.info(f"WebSocket client disconnected (total: {len(self.websockets)})")

        return ws

    async def broadcast_telemetry(self):
        """Background task to broadcast telemetry to all WebSocket clients."""
        while True:
            try:
                if self.websockets:
                    data = await self.collector.collect_all()
                    # Broadcast to all connected clients
                    disconnected = set()
                    for ws in self.websockets:
                        try:
                            await ws.send_json(data)
                        except Exception:
                            disconnected.add(ws)
                    self.websockets -= disconnected
                await asyncio.sleep(0.5)  # 2 Hz update rate
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Broadcast error: {e}")
                await asyncio.sleep(1)

    async def startup(self, app: web.Application):
        """Startup handler."""
        await self.collector.connect()
        app["broadcast_task"] = asyncio.create_task(self.broadcast_telemetry())
        logger.info(f"Telemetry server started on http://{self.host}:{self.port}")

    async def cleanup(self, app: web.Application):
        """Cleanup handler."""
        app["broadcast_task"].cancel()
        try:
            await app["broadcast_task"]
        except asyncio.CancelledError:
            pass
        await self.collector.disconnect()
        # Close all websockets
        for ws in list(self.websockets):
            await ws.close()
        logger.info("Telemetry server stopped")

    def run(self):
        """Start the server."""
        self.app.on_startup.append(self.startup)
        self.app.on_cleanup.append(self.cleanup)
        web.run_app(self.app, host=self.host, port=self.port, print=None)


def main():
    parser = argparse.ArgumentParser(description="Station B 3D Viewer Telemetry Server")
    parser.add_argument("--host", default=os.getenv("VIEWER_HOST", "0.0.0.0"), help="Server bind address")
    parser.add_argument("--port", type=int, default=int(os.getenv("VIEWER_PORT", "8090")), help="Server port")
    parser.add_argument("--plc-host", default=os.getenv("PLC_HOST", PLC_HOST), help="PLC IP address")
    parser.add_argument("--plc-port", type=int, default=int(os.getenv("PLC_PORT", str(PLC_PORT))), help="PLC TCP port")
    parser.add_argument("--static", default=os.getenv("STATIC_PATH", "/app/static"), help="Static files path")
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("Station B 3D Viewer - Telemetry Server")
    logger.info("=" * 60)
    logger.info(f"Mode: READ-ONLY (no PLC write operations)")
    logger.info(f"PLC Target: {args.plc_host}:{args.plc_port}")
    logger.info(f"Web Server: http://{args.host}:{args.port}")
    logger.info("=" * 60)

    server = TelemetryServer(
        host=args.host,
        port=args.port,
        plc_host=args.plc_host,
        plc_port=args.plc_port,
        static_path=args.static
    )
    server.run()


if __name__ == "__main__":
    main()
