# Build the API.
#
# The word lists and packs are embedded with go:embed, so the final image needs
# nothing but the binary and a CA bundle — the CA bundle because Neon and the
# JWKS endpoint are both reached over TLS, and scratch has no root certs.
FROM golang:1.26-alpine AS build

WORKDIR /src

# Dependencies first, so a code change does not re-download the module cache.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Static binary: no libc in the final image to link against.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/wordled ./cmd/wordled

FROM alpine:3.20

RUN apk add --no-cache ca-certificates

# Not root. The API reads no files and writes none, so it needs nothing else.
RUN adduser -D -u 10001 wordle
USER wordle

COPY --from=build /out/wordled /usr/local/bin/wordled

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/wordled"]
