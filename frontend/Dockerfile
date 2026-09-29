FROM oven/bun:1.3-alpine AS build
WORKDIR /app
# Copy the lockfile too and install frozen, so the container resolves the exact
# versions the lockfile pins — an unpinned install pulls a vite newer than the base
# image's bun can bundle ("builtin:vite-wasm-fallback" enum error).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.3-alpine
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "run", "build/index.js"]
