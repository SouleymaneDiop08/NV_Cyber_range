PROGRAM station_electrique

  (* ================================================================= *)

  (* ===  BLOC 1 : VARIABLES (INTERFACE SCADA)                     === *)

  (* ================================================================= *)

  VAR

    (* --- COMMANDES (COILS %QX) --- *)

    CMD_CB_Toggle AT %QX0.0 : BOOL;

    CMD_DS_Line_Toggle AT %QX0.1 : BOOL;

    CMD_DS_Bus_Toggle AT %QX0.2 : BOOL;

    CMD_TX1_CB_Toggle AT %QX0.3 : BOOL;

    CMD_TX1_DS_Bus_Toggle AT %QX0.4 : BOOL;

    CMD_TX2_CB_Toggle AT %QX0.5 : BOOL;

    CMD_TX2_DS_Bus_Toggle AT %QX0.6 : BOOL;

    CMD_Feeder1_CB AT %QX1.0 : BOOL;

    CMD_Feeder2_CB AT %QX1.1 : BOOL;

    (* --- STATUS (INPUTS %IX) --- *)

    STS_Busbar_Live AT %IX0.0 : BOOL;

    (* --- CONSIGNES DE TENSION (REGLABLES VIA FUXA - %MW) --- *)

    SET_TX1_Voltage AT %MW0 : INT; (* Curseur Fuxa Transfo 1 *)

    SET_TX2_Voltage AT %MW1 : INT; (* Curseur Fuxa Transfo 2 *)

    (* --- METRIQUES GENERALES (%IW) --- *)

    MET_Freq AT %IW0 : INT;

    MET_Bus_Voltage AT %IW1 : INT; (* Tension rÃ©sultante sur la barre *)

    MET_L1_Voltage AT %IW2 : INT;

    MET_L1_Current AT %IW3 : INT;

    MET_L1_Power AT %IW4 : INT;

    (* --- METRIQUES TRANSFOS (TEMP) --- *)

    MET_TX1_OilTemp AT %IW8 : INT;

    MET_TX1_WindingTemp AT %IW9 : INT;

    MET_TX2_OilTemp AT %IW10 : INT;

    MET_TX2_WindingTemp AT %IW11 : INT;

    (* --- NOUVEAU : METRIQUES TENSION SORTIE TRANSFO (%IW) --- *)

    MET_TX1_Output_Voltage AT %IW12 : INT; 

    MET_TX2_Output_Voltage AT %IW13 : INT;

    (* --- FEEDER 1 --- *)

    MET_Fdr1_I1 AT %QW20 : INT; 

    MET_Fdr1_I2 AT %QW21 : INT;

    MET_Fdr1_I3 AT %QW22 : INT;

    CALC_Fdr1_Imax AT %IW23 : INT;

    CALC_Fdr1_Imoy AT %IW24 : INT;

    CALC_Fdr1_Unbalance AT %IW25 : INT;

    (* --- FEEDER 2 --- *)

    MET_Fdr2_I1 AT %QW30 : INT; 

    MET_Fdr2_I2 AT %QW31 : INT;

    MET_Fdr2_I3 AT %QW32 : INT;

    CALC_Fdr2_Imax AT %IW33 : INT;

    CALC_Fdr2_Imoy AT %IW34 : INT;

    CALC_Fdr2_Unbalance AT %IW35 : INT;

    (* --- ALARMES FEEDERS (Octet IX2) --- *)

    ALM_Fdr1_Surcharge AT %IX2.0 : BOOL;

    ALM_Fdr1_Desequilibre AT %IX2.1 : BOOL;

    ALM_Fdr1_Incoherence AT %IX2.2 : BOOL;

    ALM_Fdr2_Surcharge AT %IX2.3 : BOOL;

    ALM_Fdr2_Desequilibre AT %IX2.4 : BOOL;

    ALM_Fdr2_Incoherence AT %IX2.5 : BOOL;

    (* --- ALARMES TRANSFOS (Octet IX3) --- *)

    ALM_TX1_Temp_High AT %IX3.0 : BOOL;

    ALM_TX1_Temp_Crit AT %IX3.1 : BOOL;

    ALM_TX2_Temp_High AT %IX3.2 : BOOL;

    ALM_TX2_Temp_Crit AT %IX3.3 : BOOL;

  END_VAR

  (* ================================================================= *)

  (* ===  BLOC 2 : LOGIQUE INTERNE                                 === *)

  (* ================================================================= *)

  VAR

    SIM_Timer : REAL;

    First_Cycle : BOOL := TRUE;

    _Noise : REAL;

    _L1_V_Real : REAL;

    _L1_I_Real : REAL;

    _Voltage_Sum : REAL;

    _Voltage_Source_Count : REAL;

    (* Internes Feeders *)

    _F1_I1 : REAL; _F1_I2 : REAL; _F1_I3 : REAL; 

    _F1_Imoy : REAL; _F1_Imax : REAL; _F1_Unb : REAL;

    _F2_I1 : REAL; _F2_I2 : REAL; _F2_I3 : REAL; 

    _F2_Imoy : REAL; _F2_Imax : REAL; _F2_Unb : REAL;

    (* Internes thermiques transfos *)
    _TX1_LoadFactor : REAL;
    _TX2_LoadFactor : REAL;
    _TX1_ThermalStress : REAL;
    _TX2_ThermalStress : REAL;
    _TX1_OilTarget : REAL;
    _TX2_OilTarget : REAL;
    _TX1_WindTarget : REAL;
    _TX2_WindTarget : REAL;
    _TX1_OilReal : REAL;
    _TX2_OilReal : REAL;
    _TX1_WindReal : REAL;
    _TX2_WindReal : REAL;

  END_VAR

  (* --- INITIALISATION --- *)

  IF First_Cycle THEN

    MET_Freq := 50;

    MET_TX1_OilTemp := 45; 

    MET_TX2_OilTemp := 45;

    SIM_Timer := 0.0;

    (* Valeurs par dÃ©faut MODIFIÃ‰ES POUR 20KV *)

    SET_TX1_Voltage := 20;

    SET_TX2_Voltage := 20;

    (* Commandes ON *)

    CMD_CB_Toggle := TRUE;

    CMD_DS_Line_Toggle := TRUE;

    CMD_DS_Bus_Toggle := TRUE;

    CMD_TX1_CB_Toggle := TRUE;

    CMD_TX1_DS_Bus_Toggle := TRUE;

    CMD_TX2_CB_Toggle := TRUE;

    CMD_TX2_DS_Bus_Toggle := TRUE;

    CMD_Feeder1_CB := TRUE;

    CMD_Feeder2_CB := TRUE;

    First_Cycle := FALSE;

  END_IF;

  SIM_Timer := SIM_Timer + 0.05; 

  IF SIM_Timer > 1000.0 THEN SIM_Timer := 0.0; END_IF;

  (* --- SECURITE DE LA CONSIGNE (Limitation 15-25V) --- *)

  IF SET_TX1_Voltage < 15 THEN SET_TX1_Voltage := 15; END_IF;

  IF SET_TX1_Voltage > 25 THEN SET_TX1_Voltage := 25; END_IF;

  IF SET_TX2_Voltage < 15 THEN SET_TX2_Voltage := 15; END_IF;

  IF SET_TX2_Voltage > 25 THEN SET_TX2_Voltage := 25; END_IF;

  (* --- VISUALISATION (Mise Ã  jour des METRIQUES) --- *)

  (* On copie la consigne vers l'affichage %IW *)

  (* Cela affichera 20kV comme demandÃ© *)

  MET_TX1_Output_Voltage := SET_TX1_Voltage;

  MET_TX2_Output_Voltage := SET_TX2_Voltage;

  (* --- LOGIQUE DE SÃ‰CURITÃ‰ --- *)

  IF CMD_CB_Toggle THEN

      CMD_DS_Line_Toggle := TRUE;

      CMD_DS_Bus_Toggle := TRUE;

  END_IF;

  IF NOT CMD_CB_Toggle THEN

      STS_Busbar_Live := FALSE;

      CMD_TX1_CB_Toggle := FALSE;

      CMD_TX2_CB_Toggle := FALSE;

  ELSE

      STS_Busbar_Live := TRUE;

  END_IF;

  IF CMD_TX1_CB_Toggle THEN CMD_TX1_DS_Bus_Toggle := TRUE; END_IF;

  IF CMD_TX2_CB_Toggle THEN CMD_TX2_DS_Bus_Toggle := TRUE; END_IF;

  (* --- SIMULATION DE LA TENSION BUS --- *)

  _Voltage_Sum := 0.0;

  _Voltage_Source_Count := 0.0;

  IF CMD_TX1_CB_Toggle THEN

     (* ICI : On multiplie par 5.5 pour que le Bus soit Ã  110 quand le Setpoint est Ã  20 *)

     _Voltage_Sum := _Voltage_Sum + (INT_TO_REAL(SET_TX1_Voltage) * 5.5);

     _Voltage_Source_Count := _Voltage_Source_Count + 1.0;

  END_IF;

  IF CMD_TX2_CB_Toggle THEN

     (* ICI : On multiplie par 5.5 pour que le Bus soit Ã  110 quand le Setpoint est Ã  20 *)

     _Voltage_Sum := _Voltage_Sum + (INT_TO_REAL(SET_TX2_Voltage) * 5.5);

     _Voltage_Source_Count := _Voltage_Source_Count + 1.0;

  END_IF;

  IF STS_Busbar_Live AND (_Voltage_Source_Count > 0.0) THEN

     _L1_V_Real := (_Voltage_Sum / _Voltage_Source_Count) + SIN(SIM_Timer * 0.5);

     MET_Bus_Voltage := REAL_TO_INT(_L1_V_Real);

  ELSE

     _L1_V_Real := 0.0;

     MET_Bus_Voltage := 0;

  END_IF;
 
  MET_L1_Voltage := MET_Bus_Voltage;

  MET_Freq := REAL_TO_INT(50.0 + SIN(SIM_Timer));

  IF STS_Busbar_Live THEN 

    _L1_I_Real := 420.0 + COS(SIM_Timer) * 10.0;

  ELSE 

    _L1_I_Real := 0.0;

  END_IF;

  MET_L1_Current := REAL_TO_INT(_L1_I_Real);

  MET_L1_Power := REAL_TO_INT((_L1_V_Real * _L1_I_Real * 1.732) / 1000.0);

  (* --- THERMIQUE TRANSFOS (plus réaliste) --- *)
  (* Principe : la charge des feeders alimente un facteur de charge transfo. *)
  (* L’enroulement chauffe plus vite que l’huile, l’huile refroidit lentement. *)
  (* Si la charge devient durablement anormale, un emballement thermique apparaît. *)

  _TX1_OilReal := INT_TO_REAL(MET_TX1_OilTemp);
  _TX2_OilReal := INT_TO_REAL(MET_TX2_OilTemp);
  _TX1_WindReal := INT_TO_REAL(MET_TX1_WindingTemp);
  _TX2_WindReal := INT_TO_REAL(MET_TX2_WindingTemp);

  IF CMD_TX1_CB_Toggle AND STS_Busbar_Live THEN
    _TX1_LoadFactor := _F1_Imax / 180.0;
    IF _TX1_LoadFactor < 0.0 THEN _TX1_LoadFactor := 0.0; END_IF;
    _TX1_ThermalStress := _TX1_LoadFactor * _TX1_LoadFactor;
    IF _TX1_LoadFactor > 1.35 THEN
      _TX1_ThermalStress := _TX1_ThermalStress + ((_TX1_LoadFactor - 1.35) * (_TX1_LoadFactor - 1.35) * 10.0);
    END_IF;

    _TX1_OilTarget := 42.0 + (_TX1_ThermalStress * 22.0);
    _TX1_WindTarget := _TX1_OilTarget + 8.0 + (_TX1_ThermalStress * 10.0);

    _TX1_OilReal := _TX1_OilReal + ((_TX1_OilTarget - _TX1_OilReal) * 0.035);
    _TX1_WindReal := _TX1_WindReal + ((_TX1_WindTarget - _TX1_WindReal) * 0.065);
  ELSE
    _TX1_OilReal := _TX1_OilReal + ((28.0 - _TX1_OilReal) * 0.020);
    _TX1_WindReal := _TX1_WindReal + ((_TX1_OilReal + 3.0 - _TX1_WindReal) * 0.030);
    MET_TX1_Output_Voltage := 0;
  END_IF;

  IF CMD_TX2_CB_Toggle AND STS_Busbar_Live THEN
    _TX2_LoadFactor := _F2_Imax / 210.0;
    IF _TX2_LoadFactor < 0.0 THEN _TX2_LoadFactor := 0.0; END_IF;
    _TX2_ThermalStress := _TX2_LoadFactor * _TX2_LoadFactor;
    IF _TX2_LoadFactor > 1.35 THEN
      _TX2_ThermalStress := _TX2_ThermalStress + ((_TX2_LoadFactor - 1.35) * (_TX2_LoadFactor - 1.35) * 10.0);
    END_IF;

    _TX2_OilTarget := 42.0 + (_TX2_ThermalStress * 22.0);
    _TX2_WindTarget := _TX2_OilTarget + 8.0 + (_TX2_ThermalStress * 10.0);

    _TX2_OilReal := _TX2_OilReal + ((_TX2_OilTarget - _TX2_OilReal) * 0.035);
    _TX2_WindReal := _TX2_WindReal + ((_TX2_WindTarget - _TX2_WindReal) * 0.065);
  ELSE
    _TX2_OilReal := _TX2_OilReal + ((28.0 - _TX2_OilReal) * 0.020);
    _TX2_WindReal := _TX2_WindReal + ((_TX2_OilReal + 3.0 - _TX2_WindReal) * 0.030);
    MET_TX2_Output_Voltage := 0;
  END_IF;

  IF _TX1_OilReal < 20.0 THEN _TX1_OilReal := 20.0; END_IF;
  IF _TX1_WindReal < _TX1_OilReal + 2.0 THEN _TX1_WindReal := _TX1_OilReal + 2.0; END_IF;
  IF _TX2_OilReal < 20.0 THEN _TX2_OilReal := 20.0; END_IF;
  IF _TX2_WindReal < _TX2_OilReal + 2.0 THEN _TX2_WindReal := _TX2_OilReal + 2.0; END_IF;

  MET_TX1_OilTemp := REAL_TO_INT(_TX1_OilReal);
  MET_TX1_WindingTemp := REAL_TO_INT(_TX1_WindReal);
  MET_TX2_OilTemp := REAL_TO_INT(_TX2_OilReal);
  MET_TX2_WindingTemp := REAL_TO_INT(_TX2_WindReal);
  (* --- FEEDERS (Code standard) --- *)
  _Noise := SIN(SIM_Timer * 0.2) * 4.0;
  IF STS_Busbar_Live AND CMD_TX1_DS_Bus_Toggle AND CMD_TX1_CB_Toggle AND CMD_Feeder1_CB THEN
        _F1_I1 := 180.0 + _Noise + COS(SIM_Timer)*2.0;
        _F1_I2 := 175.0 + _Noise - SIN(SIM_Timer)*2.0; 
        _F1_I3 := 182.0 + _Noise;
  ELSE
        _F1_I1 := 0.0; _F1_I2 := 0.0; _F1_I3 := 0.0;
  END_IF;
 
  MET_Fdr1_I1 := REAL_TO_INT(_F1_I1); MET_Fdr1_I2 := REAL_TO_INT(_F1_I2); MET_Fdr1_I3 := REAL_TO_INT(_F1_I3);
  _F1_Imax := _F1_I1; IF _F1_I2 > _F1_Imax THEN _F1_Imax := _F1_I2; END_IF; IF _F1_I3 > _F1_Imax THEN _F1_Imax := _F1_I3; END_IF; CALC_Fdr1_Imax := REAL_TO_INT(_F1_Imax);
  _F1_Imoy := (_F1_I1 + _F1_I2 + _F1_I3) / 3.0; CALC_Fdr1_Imoy := REAL_TO_INT(_F1_Imoy);
  IF _F1_Imoy > 1.0 THEN _F1_Unb := 0.0; IF ABS(_F1_I1 - _F1_Imoy) > _F1_Unb THEN _F1_Unb := ABS(_F1_I1 - _F1_Imoy); END_IF; IF ABS(_F1_I2 - _F1_Imoy) > _F1_Unb THEN _F1_Unb := ABS(_F1_I2 - _F1_Imoy); END_IF; IF ABS(_F1_I3 - _F1_Imoy) > _F1_Unb THEN _F1_Unb := ABS(_F1_I3 - _F1_Imoy); END_IF; _F1_Unb := (_F1_Unb / _F1_Imoy) * 100.0; ELSE _F1_Unb := 0.0; END_IF; CALC_Fdr1_Unbalance := REAL_TO_INT(_F1_Unb);
  ALM_Fdr1_Surcharge := (_F1_Imax >= 300.0); 
  ALM_Fdr1_Desequilibre := (_F1_Unb >= 15.0);
  ALM_Fdr1_Incoherence := (CMD_Feeder1_CB AND CMD_TX1_CB_Toggle AND STS_Busbar_Live AND _F1_Imax < 1.0) OR ((NOT CMD_Feeder1_CB) AND _F1_Imax > 10.0);
  IF STS_Busbar_Live AND CMD_TX2_DS_Bus_Toggle AND CMD_TX2_CB_Toggle AND CMD_Feeder2_CB THEN
          _F2_I1 := 210.0 + _Noise + SIN(SIM_Timer)*3.0;
          _F2_I2 := 208.0 + _Noise + COS(SIM_Timer)*3.0; 
          _F2_I3 := 215.0 + _Noise;
  ELSE
          _F2_I1 := 0.0; _F2_I2 := 0.0; _F2_I3 := 0.0;
  END_IF;
 
  MET_Fdr2_I1 := REAL_TO_INT(_F2_I1); MET_Fdr2_I2 := REAL_TO_INT(_F2_I2); MET_Fdr2_I3 := REAL_TO_INT(_F2_I3);
  _F2_Imax := _F2_I1; IF _F2_I2 > _F2_Imax THEN _F2_Imax := _F2_I2; END_IF; IF _F2_I3 > _F2_Imax THEN _F2_Imax := _F2_I3; END_IF; CALC_Fdr2_Imax := REAL_TO_INT(_F2_Imax);
  _F2_Imoy := (_F2_I1 + _F2_I2 + _F2_I3) / 3.0; CALC_Fdr2_Imoy := REAL_TO_INT(_F2_Imoy);
  IF _F2_Imoy > 1.0 THEN _F2_Unb := 0.0; IF ABS(_F2_I1 - _F2_Imoy) > _F2_Unb THEN _F2_Unb := ABS(_F2_I1 - _F2_Imoy); END_IF; IF ABS(_F2_I2 - _F2_Imoy) > _F2_Unb THEN _F2_Unb := ABS(_F2_I2 - _F2_Imoy); END_IF; IF ABS(_F2_I3 - _F2_Imoy) > _F2_Unb THEN _F2_Unb := ABS(_F2_I3 - _F2_Imoy); END_IF; _F2_Unb := (_F2_Unb / _F2_Imoy) * 100.0; ELSE _F2_Unb := 0.0; END_IF; CALC_Fdr2_Unbalance := REAL_TO_INT(_F2_Unb);
  ALM_Fdr2_Surcharge := (_F2_Imax >= 300.0); ALM_Fdr2_Desequilibre := (_F2_Unb >= 15.0);
  ALM_Fdr2_Incoherence := (CMD_Feeder2_CB AND CMD_TX2_CB_Toggle AND STS_Busbar_Live AND _F2_Imax < 1.0) OR ((NOT CMD_Feeder2_CB) AND _F2_Imax > 10.0);
  (* --- ALARMES TRANSFOS --- *)
  (* Retour à des seuils plus réalistes, basés huile + enroulement *)
  ALM_TX1_Temp_High := (MET_TX1_OilTemp >= 80) OR (MET_TX1_WindingTemp >= 95);
  ALM_TX1_Temp_Crit := (MET_TX1_OilTemp >= 95) OR (MET_TX1_WindingTemp >= 120);
  ALM_TX2_Temp_High := (MET_TX2_OilTemp >= 80) OR (MET_TX2_WindingTemp >= 95);
  ALM_TX2_Temp_Crit := (MET_TX2_OilTemp >= 95) OR (MET_TX2_WindingTemp >= 120);
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#50ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : station_electrique;
  END_RESOURCE
END_CONFIGURATION
