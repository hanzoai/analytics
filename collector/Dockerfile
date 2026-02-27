FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o collector ./cmd/collector/main.go

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/collector /usr/local/bin/collector
EXPOSE 8091
ENTRYPOINT ["collector"]
