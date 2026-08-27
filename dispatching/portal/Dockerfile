FROM node:20-alpine

WORKDIR /app

# Copy backend
COPY backend/package.json ./
RUN npm install --production

COPY backend/server.js ./
COPY frontend/public ./public

# Data volume for persistent user storage
VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "server.js"]
