# syntax=docker/dockerfile:1
# Interface antares : build Vite (Node) puis fichiers statiques servis par nginx.
# Digests à épingler au lot 2 (docker buildx imagetools inspect).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
COPY --from=build /app/dist /usr/share/nginx/html
