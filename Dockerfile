FROM node:16-alpine

WORKDIR /app

# Create directory for persistent storage
RUN mkdir -p /app/storage

COPY package*.json ./
RUN npm install --production

COPY src/ ./src/

EXPOSE 80

CMD ["node", "src/server/index.js"]
