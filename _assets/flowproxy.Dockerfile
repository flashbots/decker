# flowproxy, built from rbuilder-prism (crates/flowproxy - flowproxy moved into
# the main rbuilder repo on 2026-09-08) at the SAME ref as rbuilder-operator-reth
# and the bidding gateway, so the whole node is one repo/one ref.
#
# This is rbuilder-prism's docker/Dockerfile.flowproxy with two changes, both
# proposed upstream (branches flowproxy/dockerfile-arch-agnostic and
# flowproxy/configurable-chain-id):
#   1. arch-agnostic runtime copy: the Makefile builds target/<triple>/reproducible
#      on x86_64 and target/release elsewhere; upstream's COPY hardcodes x86_64.
#   2. flowproxy-0001-configurable-chain-id.patch: --chain-id / CHAIN_ID instead
#      of a hardcoded mainnet chain id (a devnet cannot run without it).
# The source is a NAMED build context `src` (this Dockerfile lives outside the
# repo): buildkit `--opt context:src=<git url>`, docker `--build-context src=.`.
# Private flashbots/* cargo deps get the token from the BuildKit secret gh_token;
# nothing secret is stored in the image.
#
# Two copies exist on purpose until the upstream fixes ship in a release:
# decker/_assets/flowproxy.Dockerfile (decker docker-mode builds) and alp
# operator/internal/provision/assets/flowproxy.Dockerfile (in-cluster buildkit).
# Keep them identical - the image tag hashes them.
ARG RUST_TOOLCHAIN=1.96.0
FROM docker.io/rust:${RUST_TOOLCHAIN}-trixie AS builder
RUN apt-get update && apt-get install -y --no-install-recommends libjemalloc-dev libclang-dev protobuf-compiler cmake \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY --from=src . .
COPY flowproxy-0001-configurable-chain-id.patch /build/
RUN git apply --verbose /build/flowproxy-0001-configurable-chain-id.patch
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true GIT_TERMINAL_PROMPT=0
RUN git config --global credential.https://github.com.helper '!f() { t=$(cat /run/secrets/gh_token 2>/dev/null); [ -n "$t" ] && printf "username=x-access-token\npassword=%s\n" "$t"; }; f'
RUN --mount=type=secret,id=gh_token,required=true \
    --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    SOURCE_DATE=1730000000 make build-flowproxy \
 && mkdir -p target/out \
 && cp "$(ls -1 target/*/reproducible/flowproxy target/release/flowproxy 2>/dev/null | head -1)" target/out/ \
 && cp /usr/lib/$(uname -m)-linux-gnu/libzstd.so.1 target/out/

FROM gcr.io/distroless/cc-debian13:nonroot
COPY --from=builder /build/target/out/libzstd.so.1 /usr/local/lib/libzstd.so.1
COPY --from=builder /build/target/out/flowproxy /flowproxy
ENV LD_LIBRARY_PATH=/usr/local/lib
ENTRYPOINT ["/flowproxy"]
