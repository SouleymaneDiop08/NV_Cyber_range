FROM debian:trixie-20251020

COPY . /workdir

WORKDIR /workdir

RUN mkdir /docker_persistent

VOLUME /docker_persistent

RUN apt-get update && apt-get install -y iproute2

# setup docker
# Le transfert du package (extraction du .zip) supprime le bit exécutable des
# scripts de build embarqués (install.sh, autogen.sh de libmodbus, scripts
# OpenPLC, etc.). On le rétablit récursivement AVANT l'installation, sinon
# background_installer.sh échoue en silence (masqué par le `| tee`) et
# start_openplc.sh n'est jamais généré → conteneur en crash-loop au runtime.
RUN find /workdir \
      \( -name '*.sh' -o -name 'autogen.sh' -o -name 'configure' \
         -o -name 'bootstrap' -o -name 'ltmain.sh' -o -name 'build' \) \
      -type f -exec chmod +x {} +
RUN ./install.sh docker \
    && touch /docker_persistent/mbconfig.cfg \
    && touch /docker_persistent/persistent.file \
    && mkdir /docker_persistent/st_files \
    && cp /workdir/webserver/openplc.db /docker_persistent/openplc.db \
    && mv /workdir/webserver/openplc.db /workdir/webserver/openplc_default.db \
    && cp /workdir/webserver/dnp3.cfg /docker_persistent/dnp3.cfg \
    && mv /workdir/webserver/dnp3.cfg /workdir/webserver/dnp3_default.cfg \
    && cp -r /workdir/webserver/st_files/ /docker_persistent/st_files/ \
    && mv /workdir/webserver/st_files /workdir/webserver/st_files_default \
    && cp /workdir/webserver/active_program /docker_persistent/active_program \
    && mv /workdir/webserver/active_program /workdir/webserver/active_program_default \
    && ln -s /docker_persistent/mbconfig.cfg /workdir/webserver/mbconfig.cfg \
    && ln -s /docker_persistent/persistent.file /workdir/webserver/persistent.file \
    && ln -s /docker_persistent/openplc.db /workdir/webserver/openplc.db \
    && ln -s /docker_persistent/dnp3.cfg /workdir/webserver/dnp3.cfg \
    && ln -s /docker_persistent/st_files /workdir/webserver/st_files \
    && ln -s /docker_persistent/active_program /workdir/webserver/active_program

# Démarrage automatique de l'automate à chaque boot (serveur Modbus 502 + logique
# train/énergie). Sans ça, OpenPLC boote « stopped » : pas de Modbus, simulation
# figée. On grave le flag dans la base par défaut pour qu'un `down -v` (volume
# neuf) reparte lui aussi en mode run.
RUN sqlite3 /workdir/webserver/openplc_default.db \
      "UPDATE Settings SET Value='true' WHERE Key='Start_run_mode';"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
