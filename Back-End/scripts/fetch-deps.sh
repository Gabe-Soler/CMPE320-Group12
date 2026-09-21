#!/bin/sh
set -eu

CROW_VERSION=v1.3.4
ASIO_TAG=asio-1-30-2

cd "$(dirname "$0")/.."
THIRD_PARTY=third_party

mkdir -p "$THIRD_PARTY"

if [ -f "$THIRD_PARTY/crow_all.h" ]; then
    echo "crow_all.h already present, skipping"
else
    echo "Downloading Crow $CROW_VERSION ..."
    base="https://github.com/CrowCpp/Crow/releases/download/$CROW_VERSION"
    curl -fsSL "$base/crow_all.h" -o "$THIRD_PARTY/crow_all.h.tmp"
    curl -fsSL "$base/crow_all.h.sha256" -o "$THIRD_PARTY/crow_all.h.sha256.tmp"

    expected=$(awk '{print $1}' "$THIRD_PARTY/crow_all.h.sha256.tmp")
    if command -v shasum >/dev/null 2>&1; then
        actual=$(shasum -a 256 "$THIRD_PARTY/crow_all.h.tmp" | awk '{print $1}')
    elif command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$THIRD_PARTY/crow_all.h.tmp" | awk '{print $1}')
    else
        actual="$expected"
        echo "warning: no shasum/sha256sum available, skipping checksum verification" >&2
    fi

    if [ "$expected" != "$actual" ]; then
        rm -f "$THIRD_PARTY/crow_all.h.tmp" "$THIRD_PARTY/crow_all.h.sha256.tmp"
        echo "error: crow_all.h checksum mismatch (expected $expected, got $actual)" >&2
        exit 1
    fi

    rm -f "$THIRD_PARTY/crow_all.h.sha256.tmp"
    mv "$THIRD_PARTY/crow_all.h.tmp" "$THIRD_PARTY/crow_all.h"
    echo "  -> $THIRD_PARTY/crow_all.h"
fi

if [ -f "$THIRD_PARTY/asio/include/asio.hpp" ]; then
    echo "asio already present, skipping"
else
    echo "Downloading $ASIO_TAG ..."
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    curl -fsSL "https://github.com/chriskohlhoff/asio/archive/refs/tags/$ASIO_TAG.tar.gz" \
        -o "$tmp/asio.tar.gz"

    mkdir -p "$THIRD_PARTY/asio"
    tar -xzf "$tmp/asio.tar.gz" -C "$THIRD_PARTY/asio" --strip-components=2 \
        "asio-$ASIO_TAG/asio/include"
    echo "  -> $THIRD_PARTY/asio/include"
fi

echo "Dependencies ready."
