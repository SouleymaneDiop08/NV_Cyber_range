FROM debian:12-slim

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    iproute2 iputils-ping iptables nano procps tcpdump curl \
    python3 python3-flask ulogd2 ulogd2-json supervisor && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /var/log/flask /var/log/supervisor /var/log/suricata /opt/fwui/templates /etc/firewall

RUN echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf

COPY app.py /opt/fwui/app.py
COPY index.html /opt/fwui/templates/index.html
COPY login.html /opt/fwui/templates/login.html
COPY firewall.html /opt/fwui/templates/firewall.html
COPY firewall_logs.html /opt/fwui/templates/firewall_logs.html
COPY ids.html /opt/fwui/templates/ids.html
COPY base.html /opt/fwui/templates/base.html

COPY router.conf /etc/supervisor/conf.d/router.conf
COPY suricata.yaml /etc/suricata/suricata.yaml
COPY ulogd.conf /etc/ulogd.conf
COPY ics_custom.rules /etc/suricata/rules/ics_custom.rules

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/router.conf"]
