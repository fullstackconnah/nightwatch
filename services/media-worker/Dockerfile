FROM node:22-alpine
RUN apk add --no-cache ffmpeg util-linux
# Fail the build now, not at the first probe, if ionice or the HEVC encoder is missing.
RUN ionice -c 3 true && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx265
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY fixtures ./fixtures
RUN mkdir -p /state
CMD ["node", "--experimental-strip-types", "src/server.ts"]
