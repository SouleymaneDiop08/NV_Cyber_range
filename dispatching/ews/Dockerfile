FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1
ENV NOVNC_PORT=6080
ENV VNC_PORT=5900
ENV VNC_PASSWORD=changeme
ENV RESOLUTION=1280x720
ENV USERNAME=engineer
ENV HOME=/home/$USERNAME

# Install essentials: desktop, vnc, novnc stack
RUN apt-get update && \
    apt-get -y install --no-install-recommends \
      xfce4 dbus-x11 \
      x11vnc xvfb xauth x11-utils \
      wget git nano python3 python3-pip python3-websockify \
      ca-certificates supervisor sudo \
      net-tools procps pulseaudio-utils \
      git build-essential cmake qtbase5-dev \
      openssh-server \
      sssd sssd-ldap sssd-krb5 libpam-sss \
      krb5-user openssl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*


# Add user
RUN useradd -m -s /bin/bash ${USERNAME} && \
    echo "${USERNAME}:ews123" | chpasswd && \
    usermod -aG sudo ${USERNAME}

# Install noVNC + websockify
RUN git clone https://github.com/novnc/noVNC.git /opt/noVNC && \
    git clone https://github.com/novnc/websockify /opt/noVNC/utils/websockify || true && \
    ln -sf /opt/noVNC/vnc.html /opt/noVNC/index.html && \
    chmod -R a+rx /opt/noVNC

RUN git clone https://github.com/thiagoralves/OpenPLC_Editor.git /opt/OpenPLC_Editor \
 && cd /opt/OpenPLC_Editor \
 # Patch install.sh so wxPython installs from prebuilt wheel if possible
 && sed -i 's#-m pip install wxPython==4.2.0#-m pip install wxPython==4.2.0 --find-links https://extras.wxpython.org/wxPython4/extras/linux/gtk3/ubuntu-22.04/ --only-binary wxPython#g' install.sh \
 && ./install.sh

RUN chown -R ${USERNAME}:${USERNAME} /opt/OpenPLC_Editor

RUN apt-get update && \
    apt-get -y install --no-install-recommends \
    xfce4-terminal libgdk-pixbuf-2.0-0 librsvg2-2 dbus-x11 libsdl2-2.0-0 \
    && apt install iputils-ping \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
    
RUN apt-get update && apt-get install -y \
    adwaita-icon-theme \
    tango-icon-theme \
    hicolor-icon-theme \
    gnome-icon-theme \
    thunar-volman tumbler \
 && rm -rf /var/lib/apt/lists/*


RUN apt-get update && apt-get install -y software-properties-common && \
    add-apt-repository -y ppa:mozillateam/ppa && \
    echo 'Package: *\nPin: release o=LP-PPA-mozillateam\nPin-Priority: 1001' > /etc/apt/preferences.d/mozilla-firefox && \
    apt-get update && apt-get install -y firefox && \
    rm -rf /var/lib/apt/lists/*


# Supervisor config (xvfb, x11vnc, websockify)
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Configs AD / SSSD
COPY sssd.conf /etc/sssd/sssd.conf
COPY krb5.conf /etc/krb5.conf
RUN chmod 600 /etc/sssd/sssd.conf

# PAM x11vnc — utilise common-auth (SSSD inclus via pam-auth-update)
RUN echo "@include common-auth\n@include common-account" > /etc/pam.d/x11vnc

# Entrypoint script
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

COPY Program /home/engineer/Desktop/ProgrammePLC/
COPY stationA.st /home/${USERNAME}/Desktop/
COPY stationB.st /home/${USERNAME}/Desktop/

# Create Desktop shortcut for OpenPLC Editor
RUN mkdir -p /home/${USERNAME}/Desktop

RUN printf "[Desktop Entry]\n\
Version=1.0\n\
Type=Application\n\
Name=OpenPLC Editor\n\
Comment=OpenPLC Ladder Logic Editor\n\
Exec=/bin/bash -lc '/opt/OpenPLC_Editor/openplc_editor.sh'\n\
Icon=utilities-terminal\n\
Terminal=false\n\
Categories=Development;\n" \
    > /home/${USERNAME}/Desktop/OpenPLC.desktop && \
    chmod +x /home/${USERNAME}/Desktop/OpenPLC.desktop && \
    chown ${USERNAME}:${USERNAME} /home/${USERNAME}/Desktop/OpenPLC.desktop


# --- Raccourci 1 : OpenPLC Runtime ---
# On crée le fichier .desktop
RUN printf "[Desktop Entry]\n\
Version=1.0\n\
Type=Application\n\
Name=OpenPLC Runtime\n\
Comment=Interface Web OpenPLC\n\
Exec=firefox http://192.168.10.10:8080\n\
Icon=applications-internet\n\
Path=\n\
Terminal=false\n\
StartupNotify=false" > /home/${USERNAME}/Desktop/Runtime.desktop && \
    chmod +x /home/${USERNAME}/Desktop/Runtime.desktop && \
    chown ${USERNAME}:${USERNAME} /home/${USERNAME}/Desktop/Runtime.desktop

# --- Raccourci 2 : Fuxa SCADA ---
RUN echo "[Desktop Entry]\n\
Version=1.0\n\
Type=Application\n\
Name=Fuxa SCADA\n\
Comment=Interface Web SCADA\n\
Exec=firefox http://192.168.20.10:1881\n\
Icon=applications-engineering\n\
Path=\n\
Terminal=false\n\
StartupNotify=false" > /home/${USERNAME}/Desktop/SCADA.desktop && \
    chmod +x /home/${USERNAME}/Desktop/SCADA.desktop && \
    chown ${USERNAME}:${USERNAME} /home/${USERNAME}/Desktop/SCADA.desktop

#COPY places.sqlite /home/engineer/.mozilla/firefox/ztc0wi0n.default-release/places.sqlite
#RUN chown engineer /home/engineer/.mozilla/firefox/ztc0wi0n.default-release/places.sqlite
RUN chown -R engineer:engineer /home/engineer 

# Wazuh Agent 4.14.x — surveillance EWS pour SOC (trusted=yes pour Ubuntu 22.04)
RUN echo "deb [trusted=yes] https://packages.wazuh.com/4.x/apt/ stable main" \
    > /etc/apt/sources.list.d/wazuh.list && \
    apt-get update && \
    WAZUH_MANAGER="192.168.40.10" WAZUH_AGENT_NAME="ews" \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-unauthenticated wazuh-agent && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
COPY ossec.conf /var/ossec/etc/ossec.conf
# Clé Wazuh pré-enregistrée — évite l'erreur "Duplicate agent name" au redémarrage
COPY client.keys /var/ossec/etc/client.keys
RUN chmod 640 /var/ossec/etc/client.keys && chown root:wazuh /var/ossec/etc/client.keys 2>/dev/null || chown root:root /var/ossec/etc/client.keys

EXPOSE ${NOVNC_PORT} ${VNC_PORT}

USER root
ENTRYPOINT ["/usr/local/bin/start.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
