"""
Modbus Mapping for Station B - Electric Substation
===================================================
Based on the current railway1.st PLC program.

This file defines the READ-ONLY Modbus mapping for Station B.
NO WRITE OPERATIONS ARE IMPLEMENTED - THIS IS STRICTLY DEFENSIVE.

OpenPLC Modbus Address Mapping (IEC 61131-3):
- %IW (Input Registers): 30001+ (Modbus Function 04)
- %QX (Coils): 00001+ (Modbus Function 01 read, 05 write - WE DO NOT WRITE)
- %IX (Discrete Inputs): 10001+ (Modbus Function 02)
- %MW (Holding Registers): 40001+ (Modbus Function 03)

Note: OpenPLC uses 0-based addressing internally, Modbus uses 1-based.

The viewer is read-only. It follows the same OpenPLC addresses exposed by
railway1.st, including the Feeder 2 override scenario and train telemetry.
"""

# ============================================================================
# PLC CONNECTION SETTINGS (READ-ONLY)
# ============================================================================
PLC_HOST = "192.168.20.10"  # plc_station_b on l2_network
PLC_PORT = 502              # Modbus TCP standard port

# ============================================================================
# COILS (DISCRETE OUTPUTS) - %QX - READ ONLY (Function 01)
# Address = byte*8 + bit (0-based for pymodbus)
# ============================================================================
COILS = {
    # QX0.x group
    "CMD_CB_Toggle": {"address": 0, "description": "Main Circuit Breaker Toggle"},
    "CMD_DS_Line_Toggle": {"address": 1, "description": "Line Disconnector Switch Toggle"},
    "CMD_DS_Bus_Toggle": {"address": 2, "description": "Bus Disconnector Switch Toggle"},
    "CMD_TX1_CB_Toggle": {"address": 3, "description": "Transformer 1 Circuit Breaker Toggle"},
    "CMD_TX1_DS_Bus_Toggle": {"address": 4, "description": "Transformer 1 Bus Disconnector Toggle"},
    "CMD_TX2_CB_Toggle": {"address": 5, "description": "Transformer 2 Circuit Breaker Toggle"},
    "CMD_TX2_DS_Bus_Toggle": {"address": 6, "description": "Transformer 2 Bus Disconnector Toggle"},
    # QX1.x group
    "CMD_Feeder1_CB": {"address": 8, "description": "Feeder 1 Circuit Breaker"},
    "CMD_Feeder2_CB": {"address": 9, "description": "Feeder 2 Circuit Breaker"},
}

# ============================================================================
# DISCRETE INPUTS - %IX - READ ONLY (Function 02)
# Address = byte*8 + bit (0-based for pymodbus)
# ============================================================================
DISCRETE_INPUTS = {
    # IX0.x group - Status
    "STS_Busbar_Live": {"address": 0, "description": "Busbar Energized Status"},

    # IX0.x / IX1.x group - Feeder and transformer alarms in railway1.st
    "ALM_Fdr1_Surcharge": {"address": 1, "description": "Feeder 1 Overload Alarm"},
    "ALM_Fdr1_Desequilibre": {"address": 2, "description": "Feeder 1 Imbalance Alarm"},
    "ALM_Fdr1_Incoherence": {"address": 3, "description": "Feeder 1 Incoherence Alarm"},
    "ALM_Fdr2_Surcharge": {"address": 4, "description": "Feeder 2 Overload Alarm"},
    "ALM_Fdr2_Desequilibre": {"address": 5, "description": "Feeder 2 Imbalance Alarm"},
    "ALM_Fdr2_Incoherence": {"address": 6, "description": "Feeder 2 Incoherence Alarm"},
    "ALM_TX1_Temp_High": {"address": 7, "description": "Transformer 1 High Temperature"},
    "ALM_TX1_Temp_Crit": {"address": 8, "description": "Transformer 1 Critical Temperature"},
    "ALM_TX2_Temp_High": {"address": 9, "description": "Transformer 2 High Temperature"},
    "ALM_TX2_Temp_Crit": {"address": 10, "description": "Transformer 2 Critical Temperature"},

    # DMD operational status used by the 3D viewer impact panel
    "DMD_ETAT_SIGNAL_VERT": {"address": 43, "description": "Diamniadio Signal Green"},
    "DMD_ETAT_SIGNAL_ROUGE": {"address": 44, "description": "Diamniadio Signal Red"},
    "DMD_ALM_CRITIQUE": {"address": 56, "description": "Diamniadio Critical Alarm"},
    "DMD_ALM_TENSION_BASSE": {"address": 57, "description": "Diamniadio Low Catenary Voltage"},
}

# ============================================================================
# INPUT REGISTERS - %IW - READ ONLY (Function 04)
# Address is the register number (0-based for pymodbus)
# ============================================================================
INPUT_REGISTERS = {
    # General Metrics
    "MET_Freq": {"address": 0, "unit": "Hz", "description": "Grid Frequency"},
    "MET_Bus_Voltage": {"address": 1, "unit": "kV", "description": "Bus Voltage"},
    "MET_L1_Voltage": {"address": 2, "unit": "kV", "description": "Line 1 Voltage"},
    "MET_L1_Current": {"address": 3, "unit": "A", "description": "Line 1 Current"},
    "MET_L1_Power": {"address": 4, "unit": "MW", "description": "Line 1 Power"},

    # Transformer temperatures in railway1.st
    "MET_TX1_OilTemp": {"address": 5, "unit": "C", "description": "Transformer 1 Oil Temperature"},
    "MET_TX1_WindingTemp": {"address": 6, "unit": "C", "description": "Transformer 1 Winding Temperature"},

    "MET_TX2_OilTemp": {"address": 7, "unit": "C", "description": "Transformer 2 Oil Temperature"},
    "MET_TX2_WindingTemp": {"address": 8, "unit": "C", "description": "Transformer 2 Winding Temperature"},

    # Transformer Output Voltages
    "MET_TX1_Output_Voltage": {"address": 9, "unit": "kV", "description": "Transformer 1 Output Voltage"},
    "MET_TX2_Output_Voltage": {"address": 10, "unit": "kV", "description": "Transformer 2 Output Voltage"},

    # Feeder 1 calculated values
    "MET_Fdr1_I1": {"address": 11, "unit": "A", "description": "Feeder 1 Phase 1 Current"},
    "MET_Fdr1_I2": {"address": 12, "unit": "A", "description": "Feeder 1 Phase 2 Current"},
    "MET_Fdr1_I3": {"address": 13, "unit": "A", "description": "Feeder 1 Phase 3 Current"},
    "CALC_Fdr1_Imax": {"address": 14, "unit": "A", "description": "Feeder 1 Max Current"},
    "CALC_Fdr1_Imoy": {"address": 15, "unit": "A", "description": "Feeder 1 Average Current"},
    "CALC_Fdr1_Unbalance": {"address": 16, "unit": "%", "description": "Feeder 1 Unbalance"},

    # Feeder 2 calculated values. Phase currents are on %QW0..2; see OUTPUT_REGISTERS.
    "CALC_Fdr2_Imax": {"address": 18, "unit": "A", "description": "Feeder 2 Max Current"},
    "CALC_Fdr2_Imoy": {"address": 19, "unit": "A", "description": "Feeder 2 Average Current"},
    "CALC_Fdr2_Unbalance": {"address": 20, "unit": "%", "description": "Feeder 2 Unbalance"},

    # Train telemetry
    "DKR_MET_VITESSE_TRAIN": {"address": 31, "unit": "km/h", "description": "Dakar Train Speed"},
    "DKR_MET_POSITION_TRAIN": {"address": 32, "unit": "pos", "description": "Dakar Train Position"},
    "DMD_MET_VITESSE_TRAIN": {"address": 41, "unit": "km/h", "description": "Diamniadio Train Speed"},
    "DMD_MET_POSITION_TRAIN": {"address": 42, "unit": "pos", "description": "Diamniadio Train Position"},
    "DMD_MET_TENSION_CATENAIRE": {"address": 43, "unit": "V", "description": "Diamniadio Catenary Voltage"},
    "DMD_MET_NIVEAU_INCIDENT": {"address": 46, "unit": "level", "description": "Diamniadio Incident Level"},
}

# ============================================================================
# HOLDING REGISTERS - %MW - READ ONLY (Function 03)
# These are setpoints (normally writable, but WE ONLY READ)
# STUXNET SCENARIO: MW100-103 carry real TX2 telemetry hidden from FUXA.
# ============================================================================
HOLDING_REGISTERS = {
    # OpenPLC %MW0 and %MW1 map to Modbus FC03 address 1024 and 1025 (MIN_16B_RANGE=1024).
    "SET_TX1_Voltage": {"address": 1024, "unit": "kV", "description": "Transformer 1 Voltage Setpoint (%MW0)"},
    "SET_TX2_Voltage": {"address": 1025, "unit": "kV", "description": "Transformer 2 Voltage Setpoint (%MW1)"},
}

# ==========================================================================
# OUTPUT REGISTERS - %QW - READ ONLY VIA FUNCTION 03 IN OPENPLC
# railway1.st declares Feeder 2 phase currents on %QW0..2.
# ==========================================================================
OUTPUT_REGISTERS = {
    "MET_Fdr2_I1": {"address": 0, "unit": "A", "description": "Feeder 2 Phase 1 Current"},
    "MET_Fdr2_I2": {"address": 1, "unit": "A", "description": "Feeder 2 Phase 2 Current"},
    "MET_Fdr2_I3": {"address": 2, "unit": "A", "description": "Feeder 2 Phase 3 Current"},
}


def get_all_addresses():
    """Return summary of all Modbus addresses for documentation."""
    return {
        "coils": {k: v["address"] for k, v in COILS.items()},
        "discrete_inputs": {k: v["address"] for k, v in DISCRETE_INPUTS.items()},
        "input_registers": {k: v["address"] for k, v in INPUT_REGISTERS.items()},
        "holding_registers": {k: v["address"] for k, v in HOLDING_REGISTERS.items()},
        "output_registers": {k: v["address"] for k, v in OUTPUT_REGISTERS.items()},
    }


if __name__ == "__main__":
    import json
    print("Station B Modbus Mapping (READ-ONLY)")
    print("=" * 50)
    print(json.dumps(get_all_addresses(), indent=2))
