PROGRAM station_electrique
 
  VAR
    (* --- COMMANDES (sur %QX comme demandé) --- *)
    CMD_CB_Toggle AT %QX0.0 : BOOL := TRUE;
    CMD_DS_Line_Toggle AT %QX0.1 : BOOL := TRUE;
    CMD_DS_Bus_Toggle AT %QX0.2 : BOOL := TRUE;
 
    CMD_TX1_CB_Toggle AT %QX0.6 : BOOL := TRUE;
    CMD_TX1_DS_Bus_Toggle AT %QX0.7 : BOOL := TRUE;
 
    CMD_TX2_CB_Toggle AT %QX0.8 : BOOL := TRUE;
    CMD_TX2_DS_Bus_Toggle AT %QX0.9 : BOOL := TRUE;
  END_VAR
 
  VAR
    STS_Busbar1_Live AT %IX0.0 : BOOL;
    STS_Busbar2_Live AT %IX0.1 : BOOL;
  END_VAR
 
  VAR
    (* --- METRIQUES (REAL sur %MD) --- *)
    MET_Freq AT %IW0 : INT;
    MET_Bus_Voltage AT %IW1 : INT;
    MET_Voltage_Input AT %IW2 : INT;
    MET_Voltage_TX1_Output AT %IW5 : INT;
    MET_Voltage_TX2_Output AT %IW6 : INT;
    MET_L1_Current AT %IW3 : INT;
    MET_L1_Power AT %IW4 : INT;
 
 
    MET_TX1_OilTemp AT %IW8 : INT;
    MET_TX1_WindingTemp AT %IW9 : INT;
 
    MET_TX2_OilTemp AT %IW10 : INT;
    MET_TX2_WindingTemp AT %IW11 : INT;
  END_VAR
 
  VAR
    SIM_Timer : REAL := 0.0;
    First_Cycle : BOOL := FALSE;
  END_VAR
 
  (* --- INITIALISATION AU DÉMARRAGE --- *)
  IF First_Cycle THEN
    MET_Freq := 50;
    MET_TX1_OilTemp := 25;
    MET_TX1_WindingTemp := 25;
    MET_TX2_OilTemp := 25;
    MET_TX2_WindingTemp := 25;
 
    SIM_Timer := 0.0;
    First_Cycle := FALSE;
  END_IF;
 
  (* --- TIMER SIMULATION --- *)
  SIM_Timer := SIM_Timer + 0.05; (* correspond au TASK T#50ms *)
  IF SIM_Timer > 1000.0 THEN
    SIM_Timer := 0.0;
  END_IF;
 
  (* --- A. Disjoncteurs et sectionneurs (toggle direct, commande HMI sur %QX) --- *)
  IF CMD_CB_Toggle THEN
    CMD_DS_Bus_Toggle := TRUE;
    CMD_DS_Line_Toggle := TRUE;
  END_IF;
 
  (* --- Calcul lignes actives & busbar --- *)
  STS_Busbar1_Live := CMD_CB_Toggle;
 
  IF STS_Busbar1_Live THEN
 
    (* --- Transfo 1 commandes --- *)
 
    IF CMD_TX1_CB_Toggle THEN
      CMD_TX1_DS_Bus_Toggle := TRUE;
    END_IF;
 
    (* --- Transfo 2 commandes --- *)
 
    IF CMD_TX2_CB_Toggle THEN
      CMD_TX2_DS_Bus_Toggle := TRUE;
    END_IF;
 
  ELSE
    CMD_TX1_CB_Toggle := FALSE;
    CMD_TX1_DS_Bus_Toggle := FALSE;
    CMD_TX2_CB_Toggle := FALSE;
    CMD_TX2_DS_Bus_Toggle := FALSE;
 
  END_IF;
 
 
  (* --- METRIQUES / SIMULATION --- *)
  MET_Freq := REAL_TO_INT(50.0 + SIN(SIM_Timer));
 
  (* Ligne 1 métriques *)
  IF CMD_CB_Toggle THEN
    MET_Voltage_Input := REAL_TO_INT(50.0 + SIN(SIM_Timer)) - 1;
    MET_L1_Current := REAL_TO_INT(420.0 + COS(SIM_Timer) * 10.0);
    MET_L1_Power := REAL_TO_INT((INT_TO_REAL(MET_Voltage_Input) * INT_TO_REAL(MET_L1_Current) * 1.732 * 0.9) / 1000.0);
  ELSE
    MET_Voltage_Input := 0;
    MET_L1_Current := 0;
    MET_L1_Power := 0;
    MET_Freq := 0;
  END_IF;
 
  (* Busbar voltage *)
  IF STS_Busbar1_Live THEN
    MET_Bus_Voltage := REAL_TO_INT(50.1 + SIN(SIM_Timer) - 0.6);
  ELSE
    MET_Bus_Voltage := 0;
  END_IF;
 
  (* Temp TX1 *)
  IF CMD_TX1_CB_Toggle THEN
    IF MET_TX1_OilTemp < 65 THEN
        MET_TX1_OilTemp := MET_TX1_OilTemp + 1;
    ELSE
        MET_TX1_OilTemp := MET_TX1_OilTemp - 2;
    END_IF;
 
    MET_TX1_WindingTemp := REAL_TO_INT(INT_TO_REAL(MET_TX1_OilTemp) + 5.0 + (INT_TO_REAL(MET_L1_Current) / 100.0));
    MET_Voltage_TX1_Output := REAL_TO_INT(110.1 + SIN(SIM_Timer) - 1.0);
  ELSE
    IF MET_TX1_OilTemp > 25 THEN
      MET_TX1_OilTemp := MET_TX1_OilTemp - 1;
    END_IF;
    MET_TX1_WindingTemp := MET_TX1_OilTemp;
    MET_Voltage_TX1_Output := 0;
  END_IF;
 
  (* Temp TX2 *)
  IF CMD_TX2_CB_Toggle THEN
    IF MET_TX2_OilTemp < 62 THEN
        MET_TX2_OilTemp := MET_TX2_OilTemp + 1;
    ELSE 
        MET_TX2_OilTemp := MET_TX2_OilTemp - 2;
    END_IF;
    MET_TX2_WindingTemp := REAL_TO_INT(INT_TO_REAL(MET_TX2_OilTemp )+ 5.0 + (INT_TO_REAL(MET_L1_Current) / 100.0));
    MET_Voltage_TX2_Output := REAL_TO_INT(110.1 + SIN(SIM_Timer) - 1.5);
  ELSE
    IF MET_TX2_OilTemp > 25 THEN
      MET_TX2_OilTemp := MET_TX2_OilTemp - 1;
    END_IF;
    MET_TX2_WindingTemp := MET_TX2_OilTemp;
    MET_Voltage_TX2_Output := 0;
  END_IF;
 
  STS_Busbar2_Live := CMD_TX1_CB_Toggle OR CMD_TX2_CB_Toggle;
 
 
END_PROGRAM
 
CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#50ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : station_electrique;
  END_RESOURCE
END_CONFIGURATION
