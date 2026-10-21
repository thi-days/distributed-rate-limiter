FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
USER node
CMD ["node", "dist/main.js"]
