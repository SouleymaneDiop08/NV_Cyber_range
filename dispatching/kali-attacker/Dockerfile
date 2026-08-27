FROM kalilinux/kali-rolling:latest

# Build args / defaults
ARG DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1
ENV NOVNC_PORT=6080
ENV VNC_PORT=5900
ENV VNC_PASSWORD=changeme
ENV RESOLUTION=1280x720
ENV USERNAME=kali
ENV HOME=/home/$USERNAME

# Install essentials
# J'ai ajouté 'openssl' dans la ligne ci-dessous
RUN apt-get update && \
    apt-get -y install --no-install-recommends \
    kali-desktop-xfce dbus-x11 \
    x11vnc xvfb xauth x11-utils \
    wget git nano python3 python3-pip python3-websockify \
    ca-certificates supervisor sudo \
    net-tools procps pulseaudio-utils \
    iputils-ping \
    openssh-server openssl \
    dsniff \
    && mkdir -p /run/sshd \
    && ssh-keygen -A \
    && /usr/sbin/sshd \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
    
RUN useradd -m -s /bin/bash ${USERNAME} && \
    echo "${USERNAME}:kali" | chpasswd && \
    usermod -aG sudo ${USERNAME} && \
    echo "root:toor" | chpasswd && \
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config

# Install noVNC (from GitHub) and websockify
RUN git clone https://github.com/novnc/noVNC.git /opt/noVNC && \
    git clone https://github.com/novnc/websockify /opt/noVNC/utils/websockify || true && \
    chmod -R a+rx /opt/noVNC

# Create directories for runtime files
RUN mkdir -p /var/run/xvfb /var/run/x11vnc /opt/novnc/utils && chown -R ${USERNAME}:${USERNAME} ${HOME}

# Install tools + Chromium pour cartographie visuelle
RUN apt-get update && \
    apt-get -y install --no-install-recommends \
    kali-tools-top10 python3-pymodbus \
    chromium xsltproc ncat

# Dépendances Python pour NetCarto (pré-installées pour éviter le téléchargement au runtime)
RUN pip3 install flask flask-socketio python-nmap --break-system-packages

# Scripts de cartographie visuelle (Scénario 1)
RUN mkdir -p /opt/tools
COPY gen_report.py /opt/tools/gen_report.py
COPY carto_client.py /opt/tools/carto_client.py
COPY netcarto.py /opt/tools/netcarto.py
RUN chmod +x /opt/tools/gen_report.py /opt/tools/carto_client.py /opt/tools/netcarto.py

# Supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY default.xml /etc/xdg/xfce4/panel/default.xml

# Entrypoint script
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# Expose ports
EXPOSE ${NOVNC_PORT} ${VNC_PORT} 22

USER root

ENTRYPOINT ["/usr/local/bin/start.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]