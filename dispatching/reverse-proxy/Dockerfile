FROM nginx:alpine

RUN apk add --no-cache openssl \
 && mkdir -p /etc/nginx/certs \
 && openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout /etc/nginx/certs/selfsigned.key \
    -out /etc/nginx/certs/selfsigned.crt \
    -subj "/CN=ot-range-proxy"

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080 1881 8081 1882 8090 1884 6080 6081 5000 1444 1443
