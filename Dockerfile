# Build stage — dev dependencies stay out of the final image.
FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Note what is deliberately NOT copied: content/ and data/.
#
# The file-backed source reads local exports and authored JSON, which hold
# customer data and are gitignored. A deployed instance must read from Supabase
# instead — baking a data snapshot into an image would publish a copy that goes
# stale the moment anything changes and can never be corrected without a
# redeploy.

# Runs unprivileged. The node image ships a `node` user for this.
USER node

EXPOSE 3001
CMD ["node", "dist/api/server.js"]
