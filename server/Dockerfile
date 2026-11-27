# A Soundwave server. Build it from the repository's root:
#   docker build -f server/Dockerfile -t soundwave-server .
#   docker run -p 7420:7420 -v soundwave-data:/data soundwave-server
# A fixed Node release, so the same image is built every time; raised by hand (24.7 or newer).
FROM node:24.22.2-slim

WORKDIR /app
# The server's own lockfile, installed as it is (npm ci): the same ws every build.
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund
COPY src/net/protocol.ts src/net/similarity.ts src/net/
COPY src/chart/types.ts src/chart/types.ts
COPY src/game/GameSession.ts src/game/judge.ts src/game/scoring.ts src/game/replay.ts src/game/
COPY src/storage/soundwaveFile.ts src/storage/soundwaveFile.ts
COPY server/src server/src

RUN mkdir /data && chown node /data
ENV SOUNDWAVE_DATA=/data PORT=7420 NODE_ENV=production
VOLUME /data
EXPOSE 7420
# Healthy once it answers, database included (Docker and Coolify wait for it before sending players).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3   CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 7420) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
USER node
CMD ["node", "server/src/main.ts"]
