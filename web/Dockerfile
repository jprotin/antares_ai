# syntax=docker/dockerfile:1
# Interface antares : build Vite (Node) puis fichiers statiques servis par nginx.
# Images épinglées par digest (relevés le 2026-10-19 ; nginx : même image que le
# service web actuel).
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG ANTARES_COMMIT=dev
ARG ANTARES_WEB_REV=inconnu
ENV ANTARES_COMMIT=${ANTARES_COMMIT} ANTARES_WEB_REV=${ANTARES_WEB_REV}
# Sans les tests (hors contexte : ils lisent frontend/) ; tsc -b complet en pre-commit
RUN npm run build:app

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de
COPY --from=build /app/dist /usr/share/nginx/html
