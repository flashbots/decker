# flowproxy, built arch-agnostically. flowproxy-private's own
# Dockerfile.reproducible pins --target x86_64-unknown-linux-gnu (and the
# x86_64 jemalloc path), which cannot build on an arm64 host/cluster. This is
# the same build (toolchain from rust-toolchain.toml, --locked, the
# jemalloc-unprefixed feature production uses, distroless cc runtime + libzstd)
# minus the fixed target, so it builds natively on amd64 AND arm64.
# Private cargo deps (flashbots/*) get the token from the BuildKit secret
# `gh_token` - the contract flowproxy's and rbuilder-prism's Dockerfiles use;
# nothing secret is stored in the image.
#
# Two copies exist on purpose until the upstream fix (flowproxy-private
# fix/dockerfile-multiarch) ships in a release: decker/_assets/flowproxy.Dockerfile
# (decker docker-mode builds) and alp operator/internal/provision/assets/
# flowproxy.Dockerfile (in-cluster buildkit). Keep them identical.
ARG RUST_TOOLCHAIN=1.89.0
FROM docker.io/rust:${RUST_TOOLCHAIN}-trixie AS builder
RUN apt-get update && apt-get install -y --no-install-recommends libjemalloc-dev protobuf-compiler \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# The source is a NAMED build context `src` (the Dockerfile lives outside the
# repo): buildkit `--opt context:src=<git url>`, docker `--build-context src=.`
COPY --from=src . .
# proposed upstream (flowproxy-private fix/dockerfile-multiarch): --chain-id / CHAIN_ID
# instead of a hardcoded mainnet chain id - required for any devnet deployment
COPY flowproxy-0001-configurable-chain-id.patch /build/
RUN git apply --verbose /build/flowproxy-0001-configurable-chain-id.patch
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true GIT_TERMINAL_PROMPT=0
RUN git config --global credential.https://github.com.helper '!f() { t=$(cat /run/secrets/gh_token 2>/dev/null); [ -n "$t" ] && printf "username=x-access-token\npassword=%s\n" "$t"; }; f'
RUN --mount=type=secret,id=gh_token,required=true \
    --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    JEMALLOC_OVERRIDE=/usr/lib/$(uname -m)-linux-gnu/libjemalloc.a \
    cargo build --release --locked --features jemalloc-unprefixed --bin flowproxy \
 && mkdir -p /out/lib && cp target/release/flowproxy /out/flowproxy \
 && cp /usr/lib/$(uname -m)-linux-gnu/libzstd.so.1 /out/lib/libzstd.so.1

FROM gcr.io/distroless/cc-debian13:nonroot
COPY --from=builder /out/lib/libzstd.so.1 /usr/lib/libzstd.so.1
COPY --from=builder /out/flowproxy /flowproxy
ENTRYPOINT ["/flowproxy"]
