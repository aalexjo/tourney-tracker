FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm i --only=production
COPY server ./server
COPY public ./public
VOLUME ["/app/data"]
EXPOSE 5174
CMD ["node", "server/index.mjs"]
