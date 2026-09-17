PROGRAM railway

VAR
    (* --- COMMANDES Station B --- *)
    CMD_CB_Toggle AT %QX0.0 : BOOL;
    CMD_DS_Line_Toggle AT %QX0.1 : BOOL;
    CMD_DS_Bus_Toggle AT %QX0.2 : BOOL;
    CMD_TX1_CB_Toggle AT %QX0.3 : BOOL;
    CMD_TX1_DS_Bus_Toggle AT %QX0.4 : BOOL;
    CMD_TX2_CB_Toggle AT %QX0.5 : BOOL;
    CMD_TX2_DS_Bus_Toggle AT %QX0.6 : BOOL;
    CMD_Feeder1_CB AT %QX0.7 : BOOL;
    CMD_Feeder2_CB AT %QX1.0 : BOOL;

    (* --- STATUS + ALARMES Station B --- *)
    STS_Busbar_Live AT %IX0.0 : BOOL;
    ALM_Fdr1_Surcharge AT %IX0.1 : BOOL;
    ALM_Fdr1_Desequilibre AT %IX0.2 : BOOL;
    ALM_Fdr1_Incoherence AT %IX0.3 : BOOL;
    ALM_Fdr2_Surcharge AT %IX0.4 : BOOL;
    ALM_Fdr2_Desequilibre AT %IX0.5 : BOOL;
    ALM_Fdr2_Incoherence AT %IX0.6 : BOOL;
    ALM_TX1_Temp_High AT %IX0.7 : BOOL;
    ALM_TX1_Temp_Crit AT %IX1.0 : BOOL;
    ALM_TX2_Temp_High AT %IX1.1 : BOOL;
    ALM_TX2_Temp_Crit AT %IX1.2 : BOOL;

    (* --- CONSIGNES TENSION Station B --- *)
    SET_TX1_Voltage AT %MW0 : INT;
    SET_TX2_Voltage AT %MW1 : INT;

    (* --- METRIQUES Station B --- *)
    MET_Freq AT %IW0 : INT;
    MET_Bus_Voltage AT %IW1 : INT;
    MET_L1_Voltage AT %IW2 : INT;
    MET_L1_Current AT %IW3 : INT;
    MET_L1_Power AT %IW4 : INT;
    MET_TX1_OilTemp AT %IW5 : INT;
    MET_TX1_WindingTemp AT %IW6 : INT;
    MET_TX2_OilTemp AT %IW7 : INT;
    MET_TX2_WindingTemp AT %IW8 : INT;
    MET_TX1_Output_Voltage AT %IW9 : INT;
    MET_TX2_Output_Voltage AT %IW10 : INT;
    MET_Fdr1_I1 AT %IW11 : INT;
    MET_Fdr1_I2 AT %IW12 : INT;
    MET_Fdr1_I3 AT %IW13 : INT;
    CALC_Fdr1_Imax AT %IW14 : INT;
    CALC_Fdr1_Imoy AT %IW15 : INT;
    CALC_Fdr1_Unbalance AT %IW16 : INT;
    MET_Fdr2_I1 AT %QW0 : INT;
    MET_Fdr2_I2 AT %QW1 : INT;
    MET_Fdr2_I3 AT %QW2 : INT;
    CALC_Fdr2_Imax AT %IW18 : INT;
    CALC_Fdr2_Imoy AT %IW19 : INT;
    CALC_Fdr2_Unbalance AT %IW20 : INT;

    (* --- COMMANDES DKR (minimum démo) --- *)
    DKR_CMD_TRAIN_AUTORISE AT %QX1.1 : BOOL;
    DKR_CMD_DISJONCTEUR_FERME AT %QX1.2 : BOOL;
    DKR_CMD_SIGNAL_VERT_AUTORISE AT %QX1.3 : BOOL;
    DKR_CMD_ARRET_URGENCE AT %QX2.1 : BOOL;

    (* --- ETATS DKR (minimum démo) --- *)
    DKR_ETAT_PLC_OK AT %IX1.3 : BOOL;
    DKR_ETAT_GARE_OK AT %IX1.4 : BOOL;
    DKR_ETAT_TRAIN_EN_MARCHE AT %IX1.6 : BOOL;
    DKR_ETAT_SIGNAL_VERT AT %IX1.7 : BOOL;
    DKR_ETAT_SIGNAL_ROUGE AT %IX2.0 : BOOL;
    DKR_ETAT_CATENAIRE_OK AT %IX2.4 : BOOL;
    DKR_ETAT_MODE_DEGRADE AT %IX3.2 : BOOL;

    (* --- ALARMES DKR (minimum démo) --- *)
    DKR_ALM_CRITIQUE AT %IX3.4 : BOOL;
    DKR_ALM_TENSION_BASSE AT %IX3.5 : BOOL;
    DKR_ALM_SURCHARGE_TRACTION AT %IX3.6 : BOOL;
    DKR_ALM_TRANSFO_CHAUD AT %IX3.7 : BOOL;
    DKR_ALM_COMMANDE_ANORMALE AT %IX4.5 : BOOL;

    (* --- CONSIGNES DKR --- *)
    DKR_SET_VITESSE_MAX AT %MW2 : INT;
    DKR_SET_TENSION_CATENAIRE AT %MW3 : INT;
    DKR_SET_COURANT_MAX AT %MW4 : INT;
    DKR_SET_DEMANDE_TRACTION AT %MW5 : INT;
    DKR_SET_TEMP_MAX_TRANSFO AT %MW6 : INT;

    (* --- METRIQUES DKR (minimum démo) --- *)
    DKR_MET_ID_GARE AT %IW30 : INT;
    DKR_MET_VITESSE_TRAIN AT %IW31 : INT;
    DKR_MET_POSITION_TRAIN AT %IW32 : INT;
    DKR_MET_TENSION_CATENAIRE AT %IW33 : INT;
    DKR_MET_COURANT_TRACTION AT %IW34 : INT;
    DKR_MET_TEMP_TRANSFO AT %IW35 : INT;
    DKR_MET_NIVEAU_INCIDENT AT %IW36 : INT;
    DKR_MET_NOMBRE_ALARMES AT %IW37 : INT;

    (* ================================================================= *)
    (* === TRAIN-GARE DIAMNIADIO (train quittant Diamniadio)          === *)
    (* ================================================================= *)

    (* --- COMMANDES DMD (%QX7.2–%QX7.7 + %IX0.x utilisé en sortie) --- *)
    (* On continue sur les octets QX disponibles                         *)
    DMD_CMD_TRAIN_AUTORISE AT %QX2.3 : BOOL;
    DMD_CMD_DISJONCTEUR_FERME AT %QX2.4 : BOOL;
    DMD_CMD_SIGNAL_VERT_AUTORISE AT %QX2.5 : BOOL;
    DMD_CMD_ARRET_URGENCE AT %QX3.3 : BOOL;

    (* --- ETATS DMD calculés (%QX8.4–%QX10.x) --- *)
    DMD_ETAT_PLC_OK AT %IX4.7 : BOOL;
    DMD_ETAT_GARE_OK AT %IX5.0 : BOOL;
    DMD_ETAT_TRAIN_EN_MARCHE AT %IX5.2 : BOOL;
    DMD_ETAT_SIGNAL_VERT AT %IX5.3 : BOOL;
    DMD_ETAT_SIGNAL_ROUGE AT %IX5.4 : BOOL;
    DMD_ETAT_CATENAIRE_OK AT %IX6.0 : BOOL;
    DMD_ETAT_MODE_DEGRADE AT %IX6.6 : BOOL;

    (* --- ALARMES DMD calculées (%QX10.5–%QX11.x) --- *)
    DMD_ALM_CRITIQUE AT %IX7.0 : BOOL;
    DMD_ALM_TENSION_BASSE AT %IX7.1 : BOOL;
    DMD_ALM_SURCHARGE_TRACTION AT %IX7.2 : BOOL;
    DMD_ALM_TRANSFO_CHAUD AT %IX7.3 : BOOL;
    DMD_ALM_COMMANDE_ANORMALE AT %IX8.1 : BOOL;

    (* --- OVERRIDE ATTAQUE Feeder 2 — écriture Modbus FC06 sur MW10/11/12 --- *)
    OVR_Fdr2_I1 AT %MW10 : INT := 0;
    OVR_Fdr2_I2 AT %MW11 : INT := 0;
    OVR_Fdr2_I3 AT %MW12 : INT := 0;

    (* --- CONSIGNES DMD (%MW23–%MW27) --- *)
    DMD_SET_VITESSE_MAX AT %MW23 : INT;
    DMD_SET_TENSION_CATENAIRE AT %MW24 : INT;
    DMD_SET_COURANT_MAX AT %MW25 : INT;
    DMD_SET_DEMANDE_TRACTION AT %MW26 : INT;
    DMD_SET_TEMP_MAX_TRANSFO AT %MW27 : INT;

    (* --- METRIQUES DMD calculées (%MW28–%MW43) --- *)
    DMD_MET_ID_GARE AT %IW40 : INT;
    DMD_MET_VITESSE_TRAIN AT %IW41 : INT;
    DMD_MET_POSITION_TRAIN AT %IW42 : INT;
    DMD_MET_TENSION_CATENAIRE AT %IW43 : INT;
    DMD_MET_COURANT_TRACTION AT %IW44 : INT;
    DMD_MET_TEMP_TRANSFO AT %IW45 : INT;
    DMD_MET_NIVEAU_INCIDENT AT %IW46 : INT;
    DMD_MET_NOMBRE_ALARMES AT %IW47 : INT;

    (* --- SIV/SONO - information voyageurs publiee par le sous-systeme SIV --- *)
    (* Registres metier normaux: le SIV legitime publie ces valeurs.
       Une attaque falsifie ces memes registres, sans variable speciale d'attaque. *)
    SIV_PUB_POSITION_DKR AT %MW60 : INT := 0;
    SIV_PUB_RETARD_DKR AT %MW61 : INT := 0;
    SIV_PUB_POSITION_DMD AT %MW62 : INT := 0;
    SIV_PUB_RETARD_DMD AT %MW63 : INT := 0;
    SIV_PUB_SOURCE_ETAT AT %MW64 : INT := 1;          (* 1=source SIV attendue/active *)

    (* --- SIV MESSAGE OVERRIDE DMD --- *)
    (* Registre d'injection de message criminel sur les panneaux DMD.
       Valeur 0 : fonctionnement nominal, aucun impact.
       Valeur 1 : le PLC active le flag d'override — l'application
                  remplace le message SIV DMD par le message pre-defini.
       Adresse Modbus HR 1089 — ecrit par l'attaquant via FC06. *)
    SIV_DMD_MSG_ACTIF AT %MW65 : INT := 0;

    (* --- SIV ATTAQUE MULTI-QUAI (Option 2) --- *)
    (* SIV_MSG_NIVEAU : niveau d'escalade de l'attaque (FC06 → HR 1090)
         0 = nominal
         1 = positions falsifiees + retards errones (furtif)
         2 = service perturbe + avance annoncee (-10 min)
         3 = alerte securite totale, evacuation multi-quai
       SIV_DKR_MSG_ACTIF : override message criminel panneau DKR (FC06 → HR 1091) *)
    SIV_MSG_NIVEAU AT %MW66 : INT := 0;
    SIV_DKR_MSG_ACTIF AT %MW67 : INT := 0;

    SIV_ALM_DESINFO_DKR AT %IX8.3 : BOOL;
    SIV_ALM_DESINFO_DMD AT %IX8.4 : BOOL;
    SIV_ALM_MSG_CRIMINEL AT %IX8.5 : BOOL;            (* flag message override DMD actif *)
    SIV_ALM_MSG_DKR AT %IX8.6 : BOOL;                 (* flag message override DKR actif — DI70 *)
    SIV_ALM_CRISE_TOTALE AT %IX8.7 : BOOL;            (* crise SIV totale (niveau >= 2) — DI71 *)
    SIV_MET_POSITION_ANNONCEE_DKR AT %IW60 : INT;
    SIV_MET_ECART_POSITION_DKR AT %IW61 : INT;
    SIV_MET_RETARD_ANNONCE_DKR AT %IW62 : INT;
    SIV_MET_POSITION_ANNONCEE_DMD AT %IW63 : INT;
    SIV_MET_ECART_POSITION_DMD AT %IW64 : INT;
    SIV_MET_RETARD_ANNONCE_DMD AT %IW65 : INT;
    SIV_MET_NIVEAU_DESINFO AT %IW66 : INT;
    SIV_MET_MSG_ACTIF AT %IW67 : INT;                 (* miroir lecture de SIV_DMD_MSG_ACTIF *)
    SIV_MET_MSG_NIVEAU AT %IW68 : INT;                (* miroir lecture de SIV_MSG_NIVEAU — IR68 *)
    SIV_MET_DKR_MSG_ACTIF AT %IW69 : INT;             (* miroir lecture de SIV_DKR_MSG_ACTIF — IR69 *)

    (* ================================================================= *)
    (* === SCENARIO C - ATTAQUE CTC : DEVIATION AIGUILLE             === *)
    (* ================================================================= *)
    (* Un attaquant ecrit 1 dans CTC_AIGUILLE_CMD (coil 32 via FC05).   *)
    (* Cela devie l'aiguille et met les deux trains sur la meme voie.    *)
    (* Le PLC calcule le risque de collision en temps reel.              *)
    (*                                                                   *)
    (* Registre            Adresse Modbus  Description                  *)
    (* CTC_AIGUILLE_CMD    QX4.0  coil 32  Commande deviation aiguille  *)
    (* CTC_AIGUILLE_DEVIEE IX9.0  discr 72 Feedback position aiguille   *)
    (* CTC_ALM_AIGUILLE    IX9.1  discr 73 Alarme aiguille deviee       *)
    (* CTC_ALM_COLLISION   IX9.2  discr 74 Alarme collision imminente   *)
    (* CTC_COLLISION_RISK  MW70   HR 1094  Niveau risque 0-100           *)
    (* CTC_COLLISION_DISTANCE IW70 IR 70  Distance inter-trains (PLC u) *)
    (* CTC_MET_RISK_LEVEL  IW71   IR 71   Miroir risk level lecture      *)
    (* CTC_MET_POINT_IMPACT IW72  IR 72   Position PLC du point impact   *)

    CTC_AIGUILLE_CMD AT %QX4.0 : BOOL := FALSE;       (* coil 32 - ecrit par l'attaquant FC05 *)
    CTC_AIGUILLE_DEVIEE AT %IX9.0 : BOOL;             (* discrete 72 - feedback aiguille *)
    CTC_ALM_AIGUILLE AT %IX9.1 : BOOL;                (* discrete 73 - alarme aiguille deviee *)
    CTC_ALM_COLLISION AT %IX9.2 : BOOL;               (* discrete 74 - collision imminente *)
    CTC_COLLISION_RISK AT %MW70 : INT := 0;            (* HR 1094 - risque 0 a 100 *)
    CTC_COLLISION_DISTANCE AT %IW70 : INT;             (* IR 70 - distance inter-trains *)
    CTC_MET_RISK_LEVEL AT %IW71 : INT;                 (* IR 71 - miroir risque lecture *)
    CTC_MET_POINT_IMPACT AT %IW72 : INT;                (* IR 72 - point d'impact sur la voie *)
END_VAR

VAR
    (* ================================================================= *)
    (* === VARIABLES INTERNES (sans adresse physique)                 === *)
    (* ================================================================= *)
    SIM_Timer : REAL;
    Premier_Cycle : BOOL := TRUE;
    _Noise : REAL;
    _L1_V_Real : REAL;
    _L1_I_Real : REAL;
    _Voltage_Sum : REAL;
    _Voltage_Source_Count : REAL;
    _F1_I1 : REAL;
    _F1_I2 : REAL;
    _F1_I3 : REAL;
    _F1_Imoy : REAL;
    _F1_Imax : REAL;
    _F1_Unb : REAL;
    _F2_I1 : REAL;
    _F2_I2 : REAL;
    _F2_I3 : REAL;
    _F2_Imoy : REAL;
    _F2_Imax : REAL;
    _F2_Unb : REAL;
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

    (* Internes Station B *)
    Tick_STB : INT := 0;

    (* Internes DKR *)
    Tick_DKR : INT := 0;
    EnergieOK_DKR : BOOL := TRUE;
    DefautActif_DKR : BOOL := FALSE;
    ConditionArret_DKR : BOOL := FALSE;
    CritiquePrecedent_DKR : BOOL := FALSE;
    TrainEnMarchePrecedent_DKR : BOOL := FALSE;
    Demande_DKR : INT := 0;

    (* Internes DMD *)
    Tick_DMD : INT := 0;
    EnergieOK_DMD : BOOL := TRUE;
    DefautActif_DMD : BOOL := FALSE;
    ConditionArret_DMD : BOOL := FALSE;
    CritiquePrecedent_DMD : BOOL := FALSE;
    TrainEnMarchePrecedent_DMD : BOOL := FALSE;
    Demande_DMD : INT := 0;
    AccumPosition_DKR : INT := 0;
    AccumPosition_DMD : INT := 0;
    TemporisationArret_DKR : INT := 0;
    TemporisationArret_DMD : INT := 0;
    ProchainArret_DKR : INT := 180;
    ProchainArret_DMD : INT := 680;
    DistanceArret_DKR : INT := 0;
    DistanceArret_DMD : INT := 0;
    VitesseCible_DKR : INT := 0;
    VitesseCible_DMD : INT := 0;
    TX1_Disponible : BOOL := FALSE;
    TX2_Disponible : BOOL := FALSE;
    AlimentationRail_DKR : BOOL := FALSE;
    AlimentationRail_DMD : BOOL := FALSE;
    IndexArret_DKR : INT := 1;
    IndexArret_DMD : INT := 1;
    DureeArret_DKR : INT := 160;
    DureeArret_DMD : INT := 160;
    PositionReelle_DKR : REAL := 120.0;
    PositionReelle_DMD : REAL := 620.0;
    VitesseReelle_DKR : REAL := 0.0;
    VitesseReelle_DMD : REAL := 0.0;
    VitesseCibleReelle_DKR : REAL := 0.0;
    VitesseCibleReelle_DMD : REAL := 0.0;
    K_Position_Par_Kmh_Cycle : REAL := 0.0036;
    K_Freinage : REAL := 0.0010;
    K_Accel_Kmh_Cycle : REAL := 0.25;
    K_Decel_Service_Kmh_Cycle : REAL := 0.35;
    K_Decel_Urgence_Kmh_Cycle : REAL := 0.90;
    (* Direction bidirectionnelle : TRUE = Dakar→Diamniadio, FALSE = Diamniadio→Dakar *)
    DKR_Direction_Avant : BOOL := TRUE;
    DMD_Direction_Avant : BOOL := FALSE;
    EcartSIV_DKR : INT := 0;
    EcartSIV_DMD : INT := 0;
    _EcartSIV_DKR_Raw : INT := 0;
    _EcartSIV_DMD_Raw : INT := 0;

    (* Internes CTC *)
    _CTC_Distance : REAL := 0.0;
    _CTC_Risk     : REAL := 0.0;
    _CTC_Risk_Timer : REAL := 0.0;
    _CTC_Attaque_Cycles : INT := 0;
    _CTC_Collision_Latched : BOOL := FALSE;
    _CTC_Point_Impact : REAL := 0.0;
END_VAR


    (* ================================================================= *)
    (* ===  INITIALISATION (premier cycle uniquement)                 === *)
    (* ================================================================= *)
    IF Premier_Cycle THEN
        (* --- Station B --- *)
        MET_Freq := 50;
        MET_TX1_OilTemp := 45;
        MET_TX1_WindingTemp := 55;
        MET_TX2_OilTemp := 45;
        MET_TX2_WindingTemp := 55;
        SIM_Timer := 0.0;
        SET_TX1_Voltage := 20;
        SET_TX2_Voltage := 20;
        CMD_CB_Toggle := TRUE;
        CMD_DS_Line_Toggle := TRUE;
        CMD_DS_Bus_Toggle := TRUE;
        CMD_TX1_CB_Toggle := TRUE;
        CMD_TX1_DS_Bus_Toggle := TRUE;
        CMD_TX2_CB_Toggle := TRUE;
        CMD_TX2_DS_Bus_Toggle := TRUE;
        CMD_Feeder1_CB := TRUE;
        CMD_Feeder2_CB := TRUE;

        (* --- DKR --- *)
        DKR_CMD_TRAIN_AUTORISE := TRUE;
        DKR_CMD_DISJONCTEUR_FERME := TRUE;
        DKR_CMD_SIGNAL_VERT_AUTORISE := TRUE;
        DKR_CMD_ARRET_URGENCE := FALSE;
        DKR_SET_VITESSE_MAX := 120;
        DKR_SET_TENSION_CATENAIRE := 25000;
        DKR_SET_COURANT_MAX := 800;
        DKR_SET_DEMANDE_TRACTION := 55;
        DKR_SET_TEMP_MAX_TRANSFO := 85;
        DKR_MET_POSITION_TRAIN := 120;
        DKR_MET_TEMP_TRANSFO := 42;
        PositionReelle_DKR := 120.0;
        VitesseReelle_DKR := 0.0;
        TemporisationArret_DKR := 80;
        IndexArret_DKR := 1;

        (* --- DMD --- *)
        DMD_CMD_TRAIN_AUTORISE := TRUE;
        DMD_CMD_DISJONCTEUR_FERME := TRUE;
        DMD_CMD_SIGNAL_VERT_AUTORISE := TRUE;
        DMD_CMD_ARRET_URGENCE := FALSE;
        DMD_SET_VITESSE_MAX := 110;
        DMD_SET_TENSION_CATENAIRE := 25000;
        DMD_SET_COURANT_MAX := 780;
        DMD_SET_DEMANDE_TRACTION := 55;
        DMD_SET_TEMP_MAX_TRANSFO := 85;
        DMD_MET_POSITION_TRAIN := 1960;
        DMD_MET_TEMP_TRANSFO := 43;
        PositionReelle_DMD := 1960.0;
        VitesseReelle_DMD := 0.0;
        TemporisationArret_DMD := 180;
        IndexArret_DMD := 1;
        DKR_Direction_Avant := TRUE;
        DMD_Direction_Avant := FALSE;
        SIV_PUB_POSITION_DKR := 120;
        SIV_PUB_RETARD_DKR := 0;
        SIV_PUB_POSITION_DMD := 1960;
        SIV_PUB_RETARD_DMD := 0;
        SIV_PUB_SOURCE_ETAT := 1;

        (* --- CTC --- *)
        CTC_AIGUILLE_CMD := FALSE;
        CTC_COLLISION_RISK := 0;
        CTC_MET_POINT_IMPACT := 0;
        _CTC_Attaque_Cycles := 0;
        _CTC_Collision_Latched := FALSE;
        _CTC_Point_Impact := 0.0;

        Premier_Cycle := FALSE;
    END_IF;


    (* ================================================================= *)
    (* ===  LOGIQUE STATION B                                         === *)
    (* ================================================================= *)
    SIM_Timer := SIM_Timer + 0.05;
    IF SIM_Timer > 1000.0 THEN SIM_Timer := 0.0; END_IF;

    IF SET_TX1_Voltage < 15 THEN SET_TX1_Voltage := 15; END_IF;
    IF SET_TX1_Voltage > 25 THEN SET_TX1_Voltage := 25; END_IF;
    IF SET_TX2_Voltage < 15 THEN SET_TX2_Voltage := 15; END_IF;
    IF SET_TX2_Voltage > 25 THEN SET_TX2_Voltage := 25; END_IF;

    MET_TX1_Output_Voltage := SET_TX1_Voltage;
    MET_TX2_Output_Voltage := SET_TX2_Voltage;

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

    _Voltage_Sum := 0.0;
    _Voltage_Source_Count := 0.0;

    IF CMD_TX1_CB_Toggle THEN
        _Voltage_Sum := _Voltage_Sum + (INT_TO_REAL(SET_TX1_Voltage) * 5.5);
        _Voltage_Source_Count := _Voltage_Source_Count + 1.0;
    END_IF;

    IF CMD_TX2_CB_Toggle THEN
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

    _Noise := SIN(SIM_Timer * 0.2) * 4.0;

    IF STS_Busbar_Live AND CMD_TX1_DS_Bus_Toggle AND CMD_TX1_CB_Toggle AND CMD_Feeder1_CB THEN
        _F1_I1 := 180.0 + _Noise + COS(SIM_Timer) * 2.0;
        _F1_I2 := 175.0 + _Noise - SIN(SIM_Timer) * 2.0;
        _F1_I3 := 182.0 + _Noise;
    ELSE
        _F1_I1 := 0.0;
        _F1_I2 := 0.0;
        _F1_I3 := 0.0;
    END_IF;

    MET_Fdr1_I1 := REAL_TO_INT(_F1_I1);
    MET_Fdr1_I2 := REAL_TO_INT(_F1_I2);
    MET_Fdr1_I3 := REAL_TO_INT(_F1_I3);

    _F1_Imax := _F1_I1;
    IF _F1_I2 > _F1_Imax THEN _F1_Imax := _F1_I2; END_IF;
    IF _F1_I3 > _F1_Imax THEN _F1_Imax := _F1_I3; END_IF;
    CALC_Fdr1_Imax := REAL_TO_INT(_F1_Imax);

    _F1_Imoy := (_F1_I1 + _F1_I2 + _F1_I3) / 3.0;
    CALC_Fdr1_Imoy := REAL_TO_INT(_F1_Imoy);

    IF _F1_Imoy > 1.0 THEN
        _F1_Unb := 0.0;
        IF ABS(_F1_I1 - _F1_Imoy) > _F1_Unb THEN _F1_Unb := ABS(_F1_I1 - _F1_Imoy); END_IF;
        IF ABS(_F1_I2 - _F1_Imoy) > _F1_Unb THEN _F1_Unb := ABS(_F1_I2 - _F1_Imoy); END_IF;
        IF ABS(_F1_I3 - _F1_Imoy) > _F1_Unb THEN _F1_Unb := ABS(_F1_I3 - _F1_Imoy); END_IF;
        _F1_Unb := (_F1_Unb / _F1_Imoy) * 100.0;
    ELSE
        _F1_Unb := 0.0;
    END_IF;

    CALC_Fdr1_Unbalance := REAL_TO_INT(_F1_Unb);
    ALM_Fdr1_Surcharge := (_F1_Imax >= 300.0);
    ALM_Fdr1_Desequilibre := (_F1_Unb >= 15.0);
    ALM_Fdr1_Incoherence := (CMD_Feeder1_CB AND CMD_TX1_CB_Toggle AND STS_Busbar_Live AND (_F1_Imax < 1.0))
                            OR ((NOT CMD_Feeder1_CB) AND (_F1_Imax > 10.0));

    IF STS_Busbar_Live AND CMD_TX2_DS_Bus_Toggle AND CMD_TX2_CB_Toggle AND CMD_Feeder2_CB THEN
        _F2_I1 := 160.0 + _Noise + COS(SIM_Timer) * 2.0;
        _F2_I2 := 155.0 + _Noise - SIN(SIM_Timer) * 2.0;
        _F2_I3 := 172.0 + _Noise;
    ELSE
        _F2_I1 := 0.0;
        _F2_I2 := 0.0;
        _F2_I3 := 0.0;
    END_IF;

    MET_Fdr2_I1 := REAL_TO_INT(_F2_I1);
    MET_Fdr2_I2 := REAL_TO_INT(_F2_I2);
    MET_Fdr2_I3 := REAL_TO_INT(_F2_I3);

    IF OVR_Fdr2_I1 > 0 THEN
        _F2_I1 := INT_TO_REAL(OVR_Fdr2_I1);
        _F2_I2 := INT_TO_REAL(OVR_Fdr2_I2);
        _F2_I3 := INT_TO_REAL(OVR_Fdr2_I3);
        MET_Fdr2_I1 := OVR_Fdr2_I1;
        MET_Fdr2_I2 := OVR_Fdr2_I2;
        MET_Fdr2_I3 := OVR_Fdr2_I3;
    END_IF;

    _F2_Imax := _F2_I1;
    IF _F2_I2 > _F2_Imax THEN _F2_Imax := _F2_I2; END_IF;
    IF _F2_I3 > _F2_Imax THEN _F2_Imax := _F2_I3; END_IF;
    CALC_Fdr2_Imax := REAL_TO_INT(_F2_Imax);
      
    IF _F2_Imax >= 400.0 THEN
        CMD_TX2_CB_Toggle := FALSE;
    END_IF;

    _F2_Imoy := (_F2_I1 + _F2_I2 + _F2_I3) / 3.0;
    CALC_Fdr2_Imoy := REAL_TO_INT(_F2_Imoy);

    IF _F2_Imoy > 1.0 THEN
        _F2_Unb := 0.0;
        IF ABS(_F2_I1 - _F2_Imoy) > _F2_Unb THEN _F2_Unb := ABS(_F2_I1 - _F2_Imoy); END_IF;
        IF ABS(_F2_I2 - _F2_Imoy) > _F2_Unb THEN _F2_Unb := ABS(_F2_I2 - _F2_Imoy); END_IF;
        IF ABS(_F2_I3 - _F2_Imoy) > _F2_Unb THEN _F2_Unb := ABS(_F2_I3 - _F2_Imoy); END_IF;
        _F2_Unb := (_F2_Unb / _F2_Imoy) * 100.0;
    ELSE
        _F2_Unb := 0.0;
    END_IF;

    CALC_Fdr2_Unbalance := REAL_TO_INT(_F2_Unb);
    ALM_Fdr2_Surcharge := (_F2_Imax >= 300.0);
    ALM_Fdr2_Desequilibre := (_F2_Unb >= 15.0);
    ALM_Fdr2_Incoherence := (CMD_Feeder2_CB AND CMD_TX2_CB_Toggle AND STS_Busbar_Live AND (_F2_Imax < 1.0))
                            OR ((NOT CMD_Feeder2_CB) AND (_F2_Imax > 10.0));

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
        IF ALM_Fdr2_Desequilibre THEN _TX2_LoadFactor := _TX2_LoadFactor + 0.4; END_IF;
        IF ALM_Fdr2_Surcharge THEN _TX2_LoadFactor := _TX2_LoadFactor + 0.6; END_IF;
        IF ALM_Fdr2_Incoherence THEN _TX2_LoadFactor := _TX2_LoadFactor + 0.9; END_IF;
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

    ALM_TX1_Temp_High := (MET_TX1_OilTemp >= 80) OR (MET_TX1_WindingTemp >= 95);
    ALM_TX1_Temp_Crit := (MET_TX1_OilTemp >= 95) OR (MET_TX1_WindingTemp >= 120);
    ALM_TX2_Temp_High := (MET_TX2_OilTemp >= 80) OR (MET_TX2_WindingTemp >= 95);
    ALM_TX2_Temp_Crit := (MET_TX2_OilTemp >= 95) OR (MET_TX2_WindingTemp >= 120);


    (* ================================================================= *)
    (* ===  MODELE TRAIN + COUPLAGE ENERGIE (VERSION DEMO MINIMALE)   === *)
    (* ================================================================= *)
    TX1_Disponible := STS_Busbar_Live AND CMD_TX1_CB_Toggle AND CMD_TX1_DS_Bus_Toggle AND CMD_Feeder1_CB AND (NOT ALM_TX1_Temp_Crit);
    TX2_Disponible := STS_Busbar_Live AND CMD_TX2_CB_Toggle AND CMD_TX2_DS_Bus_Toggle AND CMD_Feeder2_CB AND (NOT ALM_TX2_Temp_Crit);
    AlimentationRail_DKR := TX1_Disponible OR TX2_Disponible;
    AlimentationRail_DMD := TX2_Disponible;

    (* --- DKR --- *)
    Tick_DKR := Tick_DKR + 1;
    IF Tick_DKR > 200 THEN Tick_DKR := 0; END_IF;

    DKR_ETAT_PLC_OK := TRUE;
    EnergieOK_DKR := DKR_CMD_DISJONCTEUR_FERME AND (DKR_SET_TENSION_CATENAIRE >= 22000) AND (NOT DKR_CMD_ARRET_URGENCE) AND AlimentationRail_DKR;
    DKR_ETAT_CATENAIRE_OK := EnergieOK_DKR;
    DKR_ETAT_SIGNAL_VERT := DKR_CMD_SIGNAL_VERT_AUTORISE AND EnergieOK_DKR;
    DKR_ETAT_SIGNAL_ROUGE := NOT DKR_ETAT_SIGNAL_VERT;

    IF EnergieOK_DKR THEN
        DKR_MET_TENSION_CATENAIRE := DKR_SET_TENSION_CATENAIRE - 80 + Tick_DKR;
    ELSE
        DKR_MET_TENSION_CATENAIRE := 0;
    END_IF;

    Demande_DKR := DKR_SET_DEMANDE_TRACTION;
    IF Demande_DKR < 0 THEN Demande_DKR := 0; END_IF;
    IF Demande_DKR > 120 THEN Demande_DKR := 120; END_IF;
    IF EnergieOK_DKR AND DKR_CMD_TRAIN_AUTORISE THEN
        DKR_MET_COURANT_TRACTION := 180 + (Demande_DKR * 8) + (Tick_DKR / 4);
    ELSE
        DKR_MET_COURANT_TRACTION := 0;
    END_IF;

    IF DKR_MET_COURANT_TRACTION > DKR_SET_COURANT_MAX THEN
        IF DKR_MET_TEMP_TRANSFO < 125 THEN DKR_MET_TEMP_TRANSFO := DKR_MET_TEMP_TRANSFO + 1; END_IF;
    ELSE
        IF DKR_MET_TEMP_TRANSFO > 42 THEN DKR_MET_TEMP_TRANSFO := DKR_MET_TEMP_TRANSFO - 1; END_IF;
        IF DKR_MET_TEMP_TRANSFO < 42 THEN DKR_MET_TEMP_TRANSFO := 42; END_IF;
    END_IF;

    (* 14 gares réelles Dakar-Diamniadio — positions PLC: 120+(pk/36)*1840 *)
    IF DKR_Direction_Avant THEN
        CASE IndexArret_DKR OF
            1:  ProchainArret_DKR := 248;  DureeArret_DKR := 100;  (* Colobane *)
            2:  ProchainArret_DKR := 376;  DureeArret_DKR := 80;   (* Hann *)
            3:  ProchainArret_DKR := 503;  DureeArret_DKR := 80;   (* Dalifort *)
            4:  ProchainArret_DKR := 657;  DureeArret_DKR := 90;   (* Baux Maraîchers *)
            5:  ProchainArret_DKR := 784;  DureeArret_DKR := 100;  (* Pikine *)
            6:  ProchainArret_DKR := 912;  DureeArret_DKR := 90;   (* Thiaroye *)
            7:  ProchainArret_DKR := 1040; DureeArret_DKR := 90;   (* Yeumbeul *)
            8:  ProchainArret_DKR := 1193; DureeArret_DKR := 90;   (* KMF *)
            9:  ProchainArret_DKR := 1321; DureeArret_DKR := 80;   (* M'Bao *)
            10: ProchainArret_DKR := 1449; DureeArret_DKR := 80;   (* PNR *)
            11: ProchainArret_DKR := 1551; DureeArret_DKR := 100;  (* Rufisque *)
            12: ProchainArret_DKR := 1781; DureeArret_DKR := 80;   (* Bargny *)
            13: ProchainArret_DKR := 1960; DureeArret_DKR := 300;  (* Diamniadio — terminus *)
            ELSE ProchainArret_DKR := 248; IndexArret_DKR := 1;
        END_CASE;
    ELSE
        CASE IndexArret_DKR OF
            1:  ProchainArret_DKR := 1781; DureeArret_DKR := 80;   (* Bargny *)
            2:  ProchainArret_DKR := 1551; DureeArret_DKR := 100;  (* Rufisque *)
            3:  ProchainArret_DKR := 1449; DureeArret_DKR := 80;   (* PNR *)
            4:  ProchainArret_DKR := 1321; DureeArret_DKR := 80;   (* M'Bao *)
            5:  ProchainArret_DKR := 1193; DureeArret_DKR := 90;   (* KMF *)
            6:  ProchainArret_DKR := 1040; DureeArret_DKR := 90;   (* Yeumbeul *)
            7:  ProchainArret_DKR := 912;  DureeArret_DKR := 90;   (* Thiaroye *)
            8:  ProchainArret_DKR := 784;  DureeArret_DKR := 100;  (* Pikine *)
            9:  ProchainArret_DKR := 657;  DureeArret_DKR := 90;   (* Baux Maraîchers *)
            10: ProchainArret_DKR := 503;  DureeArret_DKR := 80;   (* Dalifort *)
            11: ProchainArret_DKR := 376;  DureeArret_DKR := 80;   (* Hann *)
            12: ProchainArret_DKR := 248;  DureeArret_DKR := 100;  (* Colobane *)
            13: ProchainArret_DKR := 120;  DureeArret_DKR := 300;  (* Dakar — terminus *)
            ELSE ProchainArret_DKR := 1781; IndexArret_DKR := 1;
        END_CASE;
    END_IF;

    IF DKR_Direction_Avant THEN
        DistanceArret_DKR := REAL_TO_INT(INT_TO_REAL(ProchainArret_DKR) - PositionReelle_DKR);
    ELSE
        DistanceArret_DKR := REAL_TO_INT(PositionReelle_DKR - INT_TO_REAL(ProchainArret_DKR));
    END_IF;
    IF DistanceArret_DKR < 0 THEN DistanceArret_DKR := 0; END_IF;

    ConditionArret_DKR := DKR_CMD_ARRET_URGENCE OR (NOT EnergieOK_DKR) OR DKR_ETAT_SIGNAL_ROUGE OR (NOT DKR_CMD_TRAIN_AUTORISE);
    VitesseCibleReelle_DKR := INT_TO_REAL(DKR_SET_VITESSE_MAX);
    IF ALM_TX2_Temp_High AND (VitesseCibleReelle_DKR > 45.0) THEN VitesseCibleReelle_DKR := 45.0; END_IF;

    IF TemporisationArret_DKR > 0 THEN
        TemporisationArret_DKR := TemporisationArret_DKR - 1;
        VitesseCibleReelle_DKR := 0.0;
    ELSIF ConditionArret_DKR THEN
        VitesseCibleReelle_DKR := 0.0;
    ELSE
        IF INT_TO_REAL(DistanceArret_DKR) <= (VitesseReelle_DKR * VitesseReelle_DKR * K_Freinage) THEN
            VitesseCibleReelle_DKR := 0.0;
        ELSIF DistanceArret_DKR <= 15 THEN
            IF VitesseCibleReelle_DKR > 12.0 THEN VitesseCibleReelle_DKR := 12.0; END_IF;
        ELSIF DistanceArret_DKR <= 35 THEN
            IF VitesseCibleReelle_DKR > 30.0 THEN VitesseCibleReelle_DKR := 30.0; END_IF;
        ELSIF DistanceArret_DKR <= 55 THEN
            IF VitesseCibleReelle_DKR > 55.0 THEN VitesseCibleReelle_DKR := 55.0; END_IF;
        ELSIF DistanceArret_DKR <= 85 THEN
            IF VitesseCibleReelle_DKR > 85.0 THEN VitesseCibleReelle_DKR := 85.0; END_IF;
        END_IF;
    END_IF;

    IF VitesseReelle_DKR < VitesseCibleReelle_DKR THEN
        VitesseReelle_DKR := VitesseReelle_DKR + K_Accel_Kmh_Cycle;
        IF VitesseReelle_DKR > VitesseCibleReelle_DKR THEN VitesseReelle_DKR := VitesseCibleReelle_DKR; END_IF;
    ELSIF VitesseReelle_DKR > VitesseCibleReelle_DKR THEN
        IF ConditionArret_DKR THEN
            VitesseReelle_DKR := VitesseReelle_DKR - K_Decel_Urgence_Kmh_Cycle;
        ELSE
            VitesseReelle_DKR := VitesseReelle_DKR - K_Decel_Service_Kmh_Cycle;
        END_IF;
        IF VitesseReelle_DKR < VitesseCibleReelle_DKR THEN VitesseReelle_DKR := VitesseCibleReelle_DKR; END_IF;
    END_IF;
    IF VitesseReelle_DKR < 0.0 THEN VitesseReelle_DKR := 0.0; END_IF;

    IF DKR_Direction_Avant THEN
        PositionReelle_DKR := PositionReelle_DKR + (VitesseReelle_DKR * K_Position_Par_Kmh_Cycle);
    ELSE
        PositionReelle_DKR := PositionReelle_DKR - (VitesseReelle_DKR * K_Position_Par_Kmh_Cycle);
    END_IF;

    IF DKR_Direction_Avant THEN
        IF PositionReelle_DKR >= INT_TO_REAL(ProchainArret_DKR) THEN
            PositionReelle_DKR := INT_TO_REAL(ProchainArret_DKR);
            VitesseReelle_DKR := 0.0;
            TemporisationArret_DKR := DureeArret_DKR;
            IF IndexArret_DKR >= 13 THEN
                DKR_Direction_Avant := FALSE;
                IndexArret_DKR := 1;
            ELSE
                IndexArret_DKR := IndexArret_DKR + 1;
            END_IF;
        END_IF;
    ELSE
        IF PositionReelle_DKR <= INT_TO_REAL(ProchainArret_DKR) THEN
            PositionReelle_DKR := INT_TO_REAL(ProchainArret_DKR);
            VitesseReelle_DKR := 0.0;
            TemporisationArret_DKR := DureeArret_DKR;
            IF IndexArret_DKR >= 13 THEN
                DKR_Direction_Avant := TRUE;
                IndexArret_DKR := 1;
            ELSE
                IndexArret_DKR := IndexArret_DKR + 1;
            END_IF;
        END_IF;
    END_IF;

    DKR_MET_VITESSE_TRAIN := REAL_TO_INT(VitesseReelle_DKR);
    DKR_MET_POSITION_TRAIN := REAL_TO_INT(PositionReelle_DKR);

    DKR_ETAT_TRAIN_EN_MARCHE := (DKR_MET_VITESSE_TRAIN > 0);
    DKR_ALM_TENSION_BASSE := NOT EnergieOK_DKR;
    DKR_ALM_SURCHARGE_TRACTION := (DKR_MET_COURANT_TRACTION > DKR_SET_COURANT_MAX);
    DKR_ALM_TRANSFO_CHAUD := (DKR_MET_TEMP_TRANSFO >= DKR_SET_TEMP_MAX_TRANSFO);
    DKR_ALM_COMMANDE_ANORMALE := (DKR_CMD_TRAIN_AUTORISE AND (NOT EnergieOK_DKR))
        OR (DKR_CMD_TRAIN_AUTORISE AND DKR_ETAT_SIGNAL_ROUGE)
        OR (DKR_CMD_ARRET_URGENCE AND DKR_CMD_TRAIN_AUTORISE);
    DKR_ALM_CRITIQUE := DKR_ALM_TENSION_BASSE OR DKR_CMD_ARRET_URGENCE OR DKR_ALM_TRANSFO_CHAUD OR DKR_ALM_COMMANDE_ANORMALE;

    DefautActif_DKR := DKR_ALM_TENSION_BASSE OR DKR_ALM_SURCHARGE_TRACTION OR DKR_ALM_TRANSFO_CHAUD OR DKR_ALM_COMMANDE_ANORMALE;
    DKR_ETAT_GARE_OK := NOT DefautActif_DKR;
    DKR_ETAT_MODE_DEGRADE := DefautActif_DKR AND (NOT DKR_ALM_CRITIQUE);
    DKR_MET_NOMBRE_ALARMES := 0;
    IF DKR_ALM_TENSION_BASSE THEN DKR_MET_NOMBRE_ALARMES := DKR_MET_NOMBRE_ALARMES + 1; END_IF;
    IF DKR_ALM_SURCHARGE_TRACTION THEN DKR_MET_NOMBRE_ALARMES := DKR_MET_NOMBRE_ALARMES + 1; END_IF;
    IF DKR_ALM_TRANSFO_CHAUD THEN DKR_MET_NOMBRE_ALARMES := DKR_MET_NOMBRE_ALARMES + 1; END_IF;
    IF DKR_ALM_COMMANDE_ANORMALE THEN DKR_MET_NOMBRE_ALARMES := DKR_MET_NOMBRE_ALARMES + 1; END_IF;
    IF DKR_ALM_CRITIQUE THEN DKR_MET_NIVEAU_INCIDENT := 3;
    ELSIF DKR_ETAT_MODE_DEGRADE THEN DKR_MET_NIVEAU_INCIDENT := 2;
    ELSE DKR_MET_NIVEAU_INCIDENT := 0;
    END_IF;
    DKR_MET_ID_GARE := 10;

    (* --- DMD --- *)
    Tick_DMD := Tick_DMD + 1;
    IF Tick_DMD > 200 THEN Tick_DMD := 0; END_IF;

    DMD_ETAT_PLC_OK := TRUE;
    EnergieOK_DMD := DMD_CMD_DISJONCTEUR_FERME AND (DMD_SET_TENSION_CATENAIRE >= 22000) AND (NOT DMD_CMD_ARRET_URGENCE) AND AlimentationRail_DMD;
    DMD_ETAT_CATENAIRE_OK := EnergieOK_DMD;
    DMD_ETAT_SIGNAL_VERT := DMD_CMD_SIGNAL_VERT_AUTORISE AND EnergieOK_DMD;
    DMD_ETAT_SIGNAL_ROUGE := NOT DMD_ETAT_SIGNAL_VERT;

    IF EnergieOK_DMD THEN
        DMD_MET_TENSION_CATENAIRE := DMD_SET_TENSION_CATENAIRE - 80 + Tick_DMD;
    ELSE
        DMD_MET_TENSION_CATENAIRE := 0;
    END_IF;

    Demande_DMD := DMD_SET_DEMANDE_TRACTION;
    IF Demande_DMD < 0 THEN Demande_DMD := 0; END_IF;
    IF Demande_DMD > 120 THEN Demande_DMD := 120; END_IF;
    IF EnergieOK_DMD AND DMD_CMD_TRAIN_AUTORISE THEN
        DMD_MET_COURANT_TRACTION := 180 + (Demande_DMD * 8) + (Tick_DMD / 4);
    ELSE
        DMD_MET_COURANT_TRACTION := 0;
    END_IF;

    IF DMD_MET_COURANT_TRACTION > DMD_SET_COURANT_MAX THEN
        IF DMD_MET_TEMP_TRANSFO < 125 THEN DMD_MET_TEMP_TRANSFO := DMD_MET_TEMP_TRANSFO + 1; END_IF;
    ELSE
        IF DMD_MET_TEMP_TRANSFO > 43 THEN DMD_MET_TEMP_TRANSFO := DMD_MET_TEMP_TRANSFO - 1; END_IF;
        IF DMD_MET_TEMP_TRANSFO < 43 THEN DMD_MET_TEMP_TRANSFO := 43; END_IF;
    END_IF;

    IF DMD_Direction_Avant THEN
        CASE IndexArret_DMD OF
            1:  ProchainArret_DMD := 248;  DureeArret_DMD := 100;  (* Colobane *)
            2:  ProchainArret_DMD := 376;  DureeArret_DMD := 80;   (* Hann *)
            3:  ProchainArret_DMD := 503;  DureeArret_DMD := 80;   (* Dalifort *)
            4:  ProchainArret_DMD := 657;  DureeArret_DMD := 90;   (* Baux Maraîchers *)
            5:  ProchainArret_DMD := 784;  DureeArret_DMD := 100;  (* Pikine *)
            6:  ProchainArret_DMD := 912;  DureeArret_DMD := 90;   (* Thiaroye *)
            7:  ProchainArret_DMD := 1040; DureeArret_DMD := 90;   (* Yeumbeul *)
            8:  ProchainArret_DMD := 1193; DureeArret_DMD := 90;   (* KMF *)
            9:  ProchainArret_DMD := 1321; DureeArret_DMD := 80;   (* M'Bao *)
            10: ProchainArret_DMD := 1449; DureeArret_DMD := 80;   (* PNR *)
            11: ProchainArret_DMD := 1551; DureeArret_DMD := 100;  (* Rufisque *)
            12: ProchainArret_DMD := 1781; DureeArret_DMD := 80;   (* Bargny *)
            13: ProchainArret_DMD := 1960; DureeArret_DMD := 300;  (* Diamniadio — terminus *)
            ELSE ProchainArret_DMD := 248; IndexArret_DMD := 1;
        END_CASE;
    ELSE
        CASE IndexArret_DMD OF
            1:  ProchainArret_DMD := 1781; DureeArret_DMD := 80;   (* Bargny *)
            2:  ProchainArret_DMD := 1551; DureeArret_DMD := 100;  (* Rufisque *)
            3:  ProchainArret_DMD := 1449; DureeArret_DMD := 80;   (* PNR *)
            4:  ProchainArret_DMD := 1321; DureeArret_DMD := 80;   (* M'Bao *)
            5:  ProchainArret_DMD := 1193; DureeArret_DMD := 90;   (* KMF *)
            6:  ProchainArret_DMD := 1040; DureeArret_DMD := 90;   (* Yeumbeul *)
            7:  ProchainArret_DMD := 912;  DureeArret_DMD := 90;   (* Thiaroye *)
            8:  ProchainArret_DMD := 784;  DureeArret_DMD := 100;  (* Pikine *)
            9:  ProchainArret_DMD := 657;  DureeArret_DMD := 90;   (* Baux Maraîchers *)
            10: ProchainArret_DMD := 503;  DureeArret_DMD := 80;   (* Dalifort *)
            11: ProchainArret_DMD := 376;  DureeArret_DMD := 80;   (* Hann *)
            12: ProchainArret_DMD := 248;  DureeArret_DMD := 100;  (* Colobane *)
            13: ProchainArret_DMD := 120;  DureeArret_DMD := 300;  (* Dakar — terminus *)
            ELSE ProchainArret_DMD := 1781; IndexArret_DMD := 1;
        END_CASE;
    END_IF;

    IF DMD_Direction_Avant THEN
        DistanceArret_DMD := REAL_TO_INT(INT_TO_REAL(ProchainArret_DMD) - PositionReelle_DMD);
    ELSE
        DistanceArret_DMD := REAL_TO_INT(PositionReelle_DMD - INT_TO_REAL(ProchainArret_DMD));
    END_IF;
    IF DistanceArret_DMD < 0 THEN DistanceArret_DMD := 0; END_IF;

    ConditionArret_DMD := DMD_CMD_ARRET_URGENCE OR (NOT EnergieOK_DMD) OR DMD_ETAT_SIGNAL_ROUGE OR (NOT DMD_CMD_TRAIN_AUTORISE);
    VitesseCibleReelle_DMD := INT_TO_REAL(DMD_SET_VITESSE_MAX);
    IF ALM_TX2_Temp_High AND (VitesseCibleReelle_DMD > 40.0) THEN VitesseCibleReelle_DMD := 40.0; END_IF;

    IF TemporisationArret_DMD > 0 THEN
        TemporisationArret_DMD := TemporisationArret_DMD - 1;
        VitesseCibleReelle_DMD := 0.0;
    ELSIF ConditionArret_DMD THEN
        VitesseCibleReelle_DMD := 0.0;
    ELSE
        IF INT_TO_REAL(DistanceArret_DMD) <= (VitesseReelle_DMD * VitesseReelle_DMD * K_Freinage) THEN
            VitesseCibleReelle_DMD := 0.0;
        ELSIF DistanceArret_DMD <= 15 THEN
            IF VitesseCibleReelle_DMD > 12.0 THEN VitesseCibleReelle_DMD := 12.0; END_IF;
        ELSIF DistanceArret_DMD <= 35 THEN
            IF VitesseCibleReelle_DMD > 30.0 THEN VitesseCibleReelle_DMD := 30.0; END_IF;
        ELSIF DistanceArret_DMD <= 55 THEN
            IF VitesseCibleReelle_DMD > 55.0 THEN VitesseCibleReelle_DMD := 55.0; END_IF;
        ELSIF DistanceArret_DMD <= 85 THEN
            IF VitesseCibleReelle_DMD > 85.0 THEN VitesseCibleReelle_DMD := 85.0; END_IF;
        END_IF;
    END_IF;

    IF VitesseReelle_DMD < VitesseCibleReelle_DMD THEN
        VitesseReelle_DMD := VitesseReelle_DMD + K_Accel_Kmh_Cycle;
        IF VitesseReelle_DMD > VitesseCibleReelle_DMD THEN VitesseReelle_DMD := VitesseCibleReelle_DMD; END_IF;
    ELSIF VitesseReelle_DMD > VitesseCibleReelle_DMD THEN
        IF ConditionArret_DMD THEN
            VitesseReelle_DMD := VitesseReelle_DMD - K_Decel_Urgence_Kmh_Cycle;
        ELSE
            VitesseReelle_DMD := VitesseReelle_DMD - K_Decel_Service_Kmh_Cycle;
        END_IF;
        IF VitesseReelle_DMD < VitesseCibleReelle_DMD THEN VitesseReelle_DMD := VitesseCibleReelle_DMD; END_IF;
    END_IF;
    IF VitesseReelle_DMD < 0.0 THEN VitesseReelle_DMD := 0.0; END_IF;

    IF DMD_Direction_Avant THEN
        PositionReelle_DMD := PositionReelle_DMD + (VitesseReelle_DMD * K_Position_Par_Kmh_Cycle);
    ELSE
        PositionReelle_DMD := PositionReelle_DMD - (VitesseReelle_DMD * K_Position_Par_Kmh_Cycle);
    END_IF;

    IF DMD_Direction_Avant THEN
        IF PositionReelle_DMD >= INT_TO_REAL(ProchainArret_DMD) THEN
            PositionReelle_DMD := INT_TO_REAL(ProchainArret_DMD);
            VitesseReelle_DMD := 0.0;
            TemporisationArret_DMD := DureeArret_DMD;
            IF IndexArret_DMD >= 13 THEN
                DMD_Direction_Avant := FALSE;
                IndexArret_DMD := 1;
            ELSE
                IndexArret_DMD := IndexArret_DMD + 1;
            END_IF;
        END_IF;
    ELSE
        IF PositionReelle_DMD <= INT_TO_REAL(ProchainArret_DMD) THEN
            PositionReelle_DMD := INT_TO_REAL(ProchainArret_DMD);
            VitesseReelle_DMD := 0.0;
            TemporisationArret_DMD := DureeArret_DMD;
            IF IndexArret_DMD >= 13 THEN
                DMD_Direction_Avant := TRUE;
                IndexArret_DMD := 1;
            ELSE
                IndexArret_DMD := IndexArret_DMD + 1;
            END_IF;
        END_IF;
    END_IF;

    DMD_MET_VITESSE_TRAIN := REAL_TO_INT(VitesseReelle_DMD);
    DMD_MET_POSITION_TRAIN := REAL_TO_INT(PositionReelle_DMD);

    DMD_ETAT_TRAIN_EN_MARCHE := (DMD_MET_VITESSE_TRAIN > 0);
    DMD_ALM_TENSION_BASSE := NOT EnergieOK_DMD;
    DMD_ALM_SURCHARGE_TRACTION := (DMD_MET_COURANT_TRACTION > DMD_SET_COURANT_MAX);
    DMD_ALM_TRANSFO_CHAUD := (DMD_MET_TEMP_TRANSFO >= DMD_SET_TEMP_MAX_TRANSFO);
    DMD_ALM_COMMANDE_ANORMALE := (DMD_CMD_TRAIN_AUTORISE AND (NOT EnergieOK_DMD))
        OR (DMD_CMD_TRAIN_AUTORISE AND DMD_ETAT_SIGNAL_ROUGE)
        OR (DMD_CMD_ARRET_URGENCE AND DMD_CMD_TRAIN_AUTORISE);
    DMD_ALM_CRITIQUE := DMD_ALM_TENSION_BASSE OR DMD_CMD_ARRET_URGENCE OR DMD_ALM_TRANSFO_CHAUD OR DMD_ALM_COMMANDE_ANORMALE;

    DefautActif_DMD := DMD_ALM_TENSION_BASSE OR DMD_ALM_SURCHARGE_TRACTION OR DMD_ALM_TRANSFO_CHAUD OR DMD_ALM_COMMANDE_ANORMALE;
    DMD_ETAT_GARE_OK := NOT DefautActif_DMD;
    DMD_ETAT_MODE_DEGRADE := DefautActif_DMD AND (NOT DMD_ALM_CRITIQUE);
    DMD_MET_NOMBRE_ALARMES := 0;
    IF DMD_ALM_TENSION_BASSE THEN DMD_MET_NOMBRE_ALARMES := DMD_MET_NOMBRE_ALARMES + 1; END_IF;
    IF DMD_ALM_SURCHARGE_TRACTION THEN DMD_MET_NOMBRE_ALARMES := DMD_MET_NOMBRE_ALARMES + 1; END_IF;
    IF DMD_ALM_TRANSFO_CHAUD THEN DMD_MET_NOMBRE_ALARMES := DMD_MET_NOMBRE_ALARMES + 1; END_IF;
    IF DMD_ALM_COMMANDE_ANORMALE THEN DMD_MET_NOMBRE_ALARMES := DMD_MET_NOMBRE_ALARMES + 1; END_IF;
    IF DMD_ALM_CRITIQUE THEN DMD_MET_NIVEAU_INCIDENT := 3;
    ELSIF DMD_ETAT_MODE_DEGRADE THEN DMD_MET_NIVEAU_INCIDENT := 2;
    ELSE DMD_MET_NIVEAU_INCIDENT := 0;
    END_IF;
    DMD_MET_ID_GARE := 20;

    (* ================================================================= *)
    (* === SCENARIO A - DESINFORMATION VOYAGEURS SIV/SONO              === *)
    (* ================================================================= *)
    (* En operation nominale, le sous-systeme SIV publie la position reelle.
       Auto-sync : le PLC met a jour SIV_PUB_POSITION si l'ecart avec la
       position reelle est inferieur a 90 unites PLC (env. 1.8 km).
       Scenario A (attaque) : l'attaquant ecrit une position distante de
       > 90 unites → le sync est bloque → l'alarme SIV se declenche. *)

    _EcartSIV_DKR_Raw := SIV_PUB_POSITION_DKR - REAL_TO_INT(PositionReelle_DKR);
    IF _EcartSIV_DKR_Raw < 0 THEN _EcartSIV_DKR_Raw := -_EcartSIV_DKR_Raw; END_IF;
    IF _EcartSIV_DKR_Raw < 90 THEN
        SIV_PUB_POSITION_DKR := REAL_TO_INT(PositionReelle_DKR);
        SIV_PUB_RETARD_DKR := 0;
    END_IF;

    _EcartSIV_DMD_Raw := SIV_PUB_POSITION_DMD - REAL_TO_INT(PositionReelle_DMD);
    IF _EcartSIV_DMD_Raw < 0 THEN _EcartSIV_DMD_Raw := -_EcartSIV_DMD_Raw; END_IF;
    IF _EcartSIV_DMD_Raw < 90 THEN
        SIV_PUB_POSITION_DMD := REAL_TO_INT(PositionReelle_DMD);
        SIV_PUB_RETARD_DMD := 0;
    END_IF;

    IF SIV_PUB_POSITION_DKR < 120 THEN SIV_PUB_POSITION_DKR := 120; END_IF;
    IF SIV_PUB_POSITION_DKR > 1960 THEN SIV_PUB_POSITION_DKR := 1960; END_IF;
    IF SIV_PUB_POSITION_DMD < 120 THEN SIV_PUB_POSITION_DMD := 120; END_IF;
    IF SIV_PUB_POSITION_DMD > 1960 THEN SIV_PUB_POSITION_DMD := 1960; END_IF;
    (* Retard negatif autorise : signifie "train annonce en avance" — vecteur d'attaque *)
    IF SIV_PUB_RETARD_DKR < -120 THEN SIV_PUB_RETARD_DKR := -120; END_IF;
    IF SIV_PUB_RETARD_DMD < -120 THEN SIV_PUB_RETARD_DMD := -120; END_IF;
    IF SIV_PUB_RETARD_DKR > 120 THEN SIV_PUB_RETARD_DKR := 120; END_IF;
    IF SIV_PUB_RETARD_DMD > 120 THEN SIV_PUB_RETARD_DMD := 120; END_IF;

    SIV_MET_POSITION_ANNONCEE_DKR := SIV_PUB_POSITION_DKR;
    SIV_MET_RETARD_ANNONCE_DKR := SIV_PUB_RETARD_DKR;
    SIV_MET_POSITION_ANNONCEE_DMD := SIV_PUB_POSITION_DMD;
    SIV_MET_RETARD_ANNONCE_DMD := SIV_PUB_RETARD_DMD;

    EcartSIV_DKR := SIV_MET_POSITION_ANNONCEE_DKR - DKR_MET_POSITION_TRAIN;
    IF EcartSIV_DKR < 0 THEN EcartSIV_DKR := -EcartSIV_DKR; END_IF;
    SIV_MET_ECART_POSITION_DKR := EcartSIV_DKR;

    EcartSIV_DMD := SIV_MET_POSITION_ANNONCEE_DMD - DMD_MET_POSITION_TRAIN;
    IF EcartSIV_DMD < 0 THEN EcartSIV_DMD := -EcartSIV_DMD; END_IF;
    SIV_MET_ECART_POSITION_DMD := EcartSIV_DMD;

    (* Seuil ecart = 100 unites PLC (~1 gare). Seuil retard = 30 min (anomalie grave) *)
    SIV_ALM_DESINFO_DKR := (SIV_MET_ECART_POSITION_DKR >= 100) OR (SIV_MET_RETARD_ANNONCE_DKR >= 30);
    SIV_ALM_DESINFO_DMD := (SIV_MET_ECART_POSITION_DMD >= 100) OR (SIV_MET_RETARD_ANNONCE_DMD >= 30);

    IF SIV_ALM_DESINFO_DKR OR SIV_ALM_DESINFO_DMD THEN
        SIV_MET_NIVEAU_DESINFO := 2;
    ELSE
        SIV_MET_NIVEAU_DESINFO := 0;
    END_IF;

    (* ================================================================= *)
    (* === SCENARIO B - MESSAGE CRIMINEL SUR PANNEAUX DMD             === *)
    (* ================================================================= *)
    (* Un attaquant ecrit 1 dans SIV_DMD_MSG_ACTIF (HR 1089 via FC06).  *)
    (* Le PLC active l'alarme SIV_ALM_MSG_CRIMINEL (IX8.5 = discrete 69) *)
    (* et expose l'etat dans SIV_MET_MSG_ACTIF (IW67).                  *)
    (* L'application remplace le ticker SIV DMD par le message pre-defini*)
    (* La valeur 0 remet en etat nominal sans trace dans le PLC.        *)
    IF SIV_DMD_MSG_ACTIF < 0 THEN SIV_DMD_MSG_ACTIF := 0; END_IF;
    IF SIV_DMD_MSG_ACTIF > 1 THEN SIV_DMD_MSG_ACTIF := 1; END_IF;

    SIV_ALM_MSG_CRIMINEL := (SIV_DMD_MSG_ACTIF = 1);
    SIV_MET_MSG_ACTIF := SIV_DMD_MSG_ACTIF;

    (* ================================================================= *)
    (* === SCENARIO SIV2 - ATTAQUE MULTI-QUAI CRISE TOTALE            === *)
    (* ================================================================= *)
    (* L'attaquant ecrit SIV_MSG_NIVEAU (HR 1090 via FC06) pour escalader.*)
    (*                                                                    *)
    (* Niveau 0 : Nominal — aucun impact                                  *)
    (* Niveau 1 : Positions falsifiees + retards errones (furtif)         *)
    (*            L'attaque boucle sur FC06 toutes les 200ms              *)
    (* Niveau 2 : Avance annoncee -15 min + messages service perturbe     *)
    (*            Les passagers se ruent sur les quais trop tot           *)
    (* Niveau 3 : Alerte securite totale + evacuation multi-quai          *)
    (*            Override automatique des deux panneaux DKR et DMD       *)
    (*            Loop-write 200ms bloque tout reset manuel               *)
    (*                                                                    *)
    (* SIV_DKR_MSG_ACTIF (HR 1091) : override panneau DKR independamment  *)

    IF SIV_MSG_NIVEAU < 0 THEN SIV_MSG_NIVEAU := 0; END_IF;
    IF SIV_MSG_NIVEAU > 3 THEN SIV_MSG_NIVEAU := 3; END_IF;
    IF SIV_DKR_MSG_ACTIF < 0 THEN SIV_DKR_MSG_ACTIF := 0; END_IF;
    IF SIV_DKR_MSG_ACTIF > 1 THEN SIV_DKR_MSG_ACTIF := 1; END_IF;

    (* Niveau 3 : force les deux panneaux en mode alerte *)
    IF SIV_MSG_NIVEAU >= 3 THEN
        SIV_DKR_MSG_ACTIF := 1;
        SIV_DMD_MSG_ACTIF := 1;
    END_IF;

    SIV_ALM_MSG_DKR       := (SIV_DKR_MSG_ACTIF = 1);
    SIV_ALM_CRISE_TOTALE  := (SIV_MSG_NIVEAU >= 2) OR
                              (SIV_ALM_MSG_DKR AND SIV_ALM_MSG_CRIMINEL);

    SIV_MET_MSG_NIVEAU    := SIV_MSG_NIVEAU;
    SIV_MET_DKR_MSG_ACTIF := SIV_DKR_MSG_ACTIF;

    (* ================================================================= *)
    (* === SCENARIO C - ATTAQUE CTC : DEVIATION AIGUILLE             === *)
    (* ================================================================= *)
    (* L'attaquant ecrit coil 32 = 1 via FC05 (CTC_AIGUILLE_CMD).       *)
    (* Le PLC devie l'aiguille et met les deux trains sur la meme voie.  *)
    (* La distance inter-trains est calculee en temps reel.              *)
    (* Le risque de collision escalade de 0 a 100 au fur et a mesure     *)
    (* que les trains se rapprochent. La collision n'est declenchee que   *)
    (* lorsque la distance reelle atteint pratiquement 0.                 *)

    CTC_AIGUILLE_DEVIEE := CTC_AIGUILLE_CMD;
    CTC_ALM_AIGUILLE := CTC_AIGUILLE_DEVIEE;

    (* Distance absolue entre les deux trains — valeur positive quelle que soit
       la direction (trains peuvent s'etre croises en fonctionnement normal) *)
    _CTC_Distance := PositionReelle_DKR - PositionReelle_DMD;
    IF _CTC_Distance < 0.0 THEN _CTC_Distance := -_CTC_Distance; END_IF;

    IF CTC_AIGUILLE_DEVIEE THEN
        IF _CTC_Attaque_Cycles < 2000 THEN
            _CTC_Attaque_Cycles := _CTC_Attaque_Cycles + 1;
        END_IF;

        CTC_COLLISION_DISTANCE := REAL_TO_INT(_CTC_Distance);

        (* Risque : 0% a 1840 unites d'ecart, 100% quand les trains sont au meme endroit *)
        _CTC_Risk := (1840.0 - _CTC_Distance) / 1840.0 * 100.0;
        IF _CTC_Risk < 0.0 THEN _CTC_Risk := 0.0; END_IF;
        IF _CTC_Risk > 100.0 THEN _CTC_Risk := 100.0; END_IF;

        CTC_COLLISION_RISK := REAL_TO_INT(_CTC_Risk);
        CTC_MET_RISK_LEVEL := CTC_COLLISION_RISK;

        (* Collision reelle : pas de raccourci demo, pas de timer.
           L'impact est verrouille uniquement lorsque les trains arrivent
           pratiquement au meme point sur la voie. *)
        IF _CTC_Distance <= 1.0 THEN
            IF NOT _CTC_Collision_Latched THEN
                _CTC_Point_Impact := (PositionReelle_DKR + PositionReelle_DMD) / 2.0;
            END_IF;
            _CTC_Collision_Latched := TRUE;
        END_IF;
        CTC_ALM_COLLISION := _CTC_Collision_Latched;

        IF _CTC_Collision_Latched THEN
            (* Impact simulé : les deux trains sont figés au même point, arrêtés,
               avec alarme critique. Les adresses existantes ne changent pas. *)
            PositionReelle_DKR := _CTC_Point_Impact;
            PositionReelle_DMD := _CTC_Point_Impact;
            VitesseReelle_DKR := 0.0;
            VitesseReelle_DMD := 0.0;

            DKR_MET_POSITION_TRAIN := REAL_TO_INT(_CTC_Point_Impact);
            DMD_MET_POSITION_TRAIN := REAL_TO_INT(_CTC_Point_Impact);
            DKR_MET_VITESSE_TRAIN := 0;
            DMD_MET_VITESSE_TRAIN := 0;

            DKR_ETAT_TRAIN_EN_MARCHE := FALSE;
            DMD_ETAT_TRAIN_EN_MARCHE := FALSE;
            DKR_ETAT_SIGNAL_VERT := FALSE;
            DMD_ETAT_SIGNAL_VERT := FALSE;
            DKR_ETAT_SIGNAL_ROUGE := TRUE;
            DMD_ETAT_SIGNAL_ROUGE := TRUE;

            DKR_ALM_CRITIQUE := TRUE;
            DMD_ALM_CRITIQUE := TRUE;
            DKR_ALM_COMMANDE_ANORMALE := TRUE;
            DMD_ALM_COMMANDE_ANORMALE := TRUE;
            DKR_ETAT_MODE_DEGRADE := FALSE;
            DMD_ETAT_MODE_DEGRADE := FALSE;
            DKR_ETAT_GARE_OK := FALSE;
            DMD_ETAT_GARE_OK := FALSE;
            DKR_MET_NIVEAU_INCIDENT := 3;
            DMD_MET_NIVEAU_INCIDENT := 3;
            IF DKR_MET_NOMBRE_ALARMES < 1 THEN DKR_MET_NOMBRE_ALARMES := 1; END_IF;
            IF DMD_MET_NOMBRE_ALARMES < 1 THEN DMD_MET_NOMBRE_ALARMES := 1; END_IF;
            CTC_COLLISION_DISTANCE := 0;
        END_IF;

        CTC_MET_POINT_IMPACT := REAL_TO_INT(_CTC_Point_Impact);
    ELSE
        (* Aiguille en position nominale - distance affichee mais risque nul *)
        _CTC_Attaque_Cycles := 0;
        _CTC_Collision_Latched := FALSE;
        _CTC_Point_Impact := 0.0;
        CTC_COLLISION_DISTANCE := REAL_TO_INT(_CTC_Distance);
        CTC_COLLISION_RISK := 0;
        CTC_MET_RISK_LEVEL := 0;
        CTC_MET_POINT_IMPACT := 0;
        CTC_ALM_COLLISION := FALSE;
    END_IF;

END_PROGRAM

CONFIGURATION Config0
    RESOURCE Res0 ON PLC
        TASK task0(INTERVAL := T#50ms, PRIORITY := 0);
        PROGRAM instance0 WITH task0 : railway;
    END_RESOURCE
END_CONFIGURATION
