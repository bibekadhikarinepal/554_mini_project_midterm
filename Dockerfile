# One image for both environments: Compose in the Lima VM and k3d.
FROM node:22.23.3-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

# The service has no npm dependencies, so only the manifest and source are copied.
COPY package.json ./
COPY src ./src

# The official Node image provides an unprivileged "node" user (uid 1000).
USER node

EXPOSE 8080
# server.js handles SIGTERM itself, so node can run directly as PID 1.
CMD ["node", "src/server.js"]
