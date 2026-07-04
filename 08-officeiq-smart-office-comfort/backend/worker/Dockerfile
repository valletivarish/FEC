FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY ingestWorker.js ./ingestWorker.js

CMD ["node", "ingestWorker.js"]
