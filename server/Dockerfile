# A Soundwave server. Build it from the repository's root:
#   docker build -f server/Dockerfile -t soundwave-server .
#   docker run -p 7420:7420 -v soundwave-data:/data soundwave-server
FROM node:24-slim

WORKDIR /app
COPY server/package.json server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY src/net/protocol.ts src/net/protocol.ts
COPY src/chart/types.ts src/chart/types.ts
COPY src/game/GameSession.ts src/game/judge.ts src/game/scoring.ts src/game/replay.ts src/game/
COPY server/src server/src

RUN mkdir /data && chown node /data
ENV SOUNDWAVE_DATA=/data PORT=7420 NODE_ENV=production
VOLUME /data
EXPOSE 7420
USER node
CMD ["node", "server/src/main.ts"]
