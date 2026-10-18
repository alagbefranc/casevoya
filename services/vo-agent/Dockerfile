# The Vo agent container (linux/amd64). Build context: services/vo-agent, after `pnpm bundle`
# has written dist/server.mjs (the service plus the shared src/modules/vo and scheduling code it
# imports from the app). The Claude Agent SDK needs Node 20+ and spawns its own CLI subprocess.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY dist/server.mjs ./server.mjs

# A non-root user with an empty home: the agent has no file tools, and nothing else is here.
RUN useradd --create-home --shell /usr/sbin/nologin vo
USER vo
ENV HOME=/home/vo PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
