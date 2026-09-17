FROM python:3.12-alpine

WORKDIR /app

RUN apk add --no-cache iproute2

COPY service.py /app/service.py
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 8080

CMD ["/app/start.sh"]
