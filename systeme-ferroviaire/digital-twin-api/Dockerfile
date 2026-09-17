FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY config ./config

ENV NODE_ENV=production
ENV PORT=4010

EXPOSE 4010

USER node
CMD ["node", "server.js"]
