# Persistent state lives on the mounted volume at /data.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 10000

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||10000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "index.js"]
