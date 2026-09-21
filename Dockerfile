FROM node:22-bookworm-slim AS web
WORKDIR /src/Front-End
COPY Front-End/package.json Front-End/package-lock.json ./
RUN npm ci
COPY Front-End/ ./
RUN npm run build

FROM gcc:14-bookworm AS server
WORKDIR /src/Back-End
COPY Back-End/ ./
RUN make deps && make build LDFLAGS="-pthread -static-libstdc++ -static-libgcc"

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=server /src/Back-End/build/server /app/server
COPY --from=web /src/Front-End/dist /app/web

ENV WEB_ROOT=/app/web \
    PORT=8080

EXPOSE 8080

USER nobody
CMD ["/app/server"]
