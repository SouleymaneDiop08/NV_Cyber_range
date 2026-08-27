FROM debian:12-slim

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    iproute2 iputils-ping tcpdump curl ca-certificates procps bridge-utils && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /sensor-logs/suricata /sensor-logs/zeek /sensor-pcap

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sleep", "infinity"]
