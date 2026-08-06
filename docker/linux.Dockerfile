# orb — linux static build image
#
# Produces a single statically-linked `orb` binary for Linux (amd64 or arm64).
# PortAudio (v19.7.0) is compiled from a pinned source tarball into a static
# archive and linked into the Go binary — the "static linking" required by
# spec R16 AC-16.5.
#
# Build (choose the target architecture):
#   docker build --target release -t orb-linux-amd64 .
#   --platform linux/amd64        (on an arm64 host Docker Desktop auto-qemu's)
#   --platform linux/arm64        (native if host is arm64)
#
# Export the artifact to the host dist/ dir (no need to run the image):
#   docker build --target release --output type=local,dest=dist -t orb-linux . .
#   --platform linux/amd64
FROM golang:1.24-bullseye AS pa
WORKDIR /src
RUN apt-get update -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
         gcc make pkg-config curl ca-certificates libasound2-dev libc6-dev \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/PortAudio/portaudio/archive/refs/tags/v19.7.0.tar.gz -o pa.tar.gz \
    && tar xzf pa.tar.gz \
    && cd portaudio-19.7.0 \
    && ./configure --disable-shared --enable-static --without-jack --with-alsa --prefix=/opt/pa \
    && make -j"$(nproc)" \
    && make install

FROM golang:1.24-bullseye AS gobuild
ARG VERSION=dev
ARG TARGETARCH
ENV PKG_CONFIG_PATH=/opt/pa/lib/pkgconfig
WORKDIR /src
COPY --from=pa /opt/pa /opt/pa
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux GOARCH=${TARGETARCH:-$(go env GOARCH)} \
    go build -a -trimpath \
      -tags 'osusergo netgo' \
      -ldflags "-s -w -linkmode external -extldflags '-static' \
                -X main.buildVersion=${VERSION}" \
      -o /out/orb .

FROM scratch AS dist
COPY --from=gobuild /out/orb /orb

# Default target when run (binary mounts /out; container just prints version).
FROM scratch
COPY --from=gobuild /out/orb /orb
ENTRYPOINT ["/orb"]