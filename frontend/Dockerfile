# Build the app into plain files.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve those files with nginx and pass /api on to the backend.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf

# The stock image allows 1024 connections per worker, and a proxied request
# uses two. Raise it so a rush of visitors queues here instead of being refused.
RUN sed -i -E 's/worker_connections[[:space:]]+[0-9]+;/worker_connections 16384;/' /etc/nginx/nginx.conf \
 && sed -i '1i worker_rlimit_nofile 65536;' /etc/nginx/nginx.conf \
 && grep -E 'worker_connections|worker_rlimit_nofile' /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
