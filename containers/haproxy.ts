import type { ContainerDef, ContainerResult, Ctx, Ports } from "../utils/types.ts";
import { portNum } from "../utils/types.ts";

// haproxy: the production node's edge (flashbots-images origin/trunk/buildernet
// etc/haproxy/haproxy.cfg.mustache). Same request pipeline - stick-table rate
// limits with a privileged-ip map, X-Flashbots-Source-Name from the map,
// /livez, user backend to flowproxy's user listener, tcp system frontend to
// its system listener - minus what needs production-only state: TLS binds
// (Let's Encrypt certs on the persistent disk), the ACME/public-cert
// frontends, the pAMM and /bob routes, the stats socket.
export const ports: Ports = {
  http: 80,
  system: 5544,
  metrics: { port: 8405, service: false },
};

// production defaults (buildernet-configs base.libsonnet haproxy.*)
const LIMITS = {
  bytes_in_rate_regular: "600000000",
  bytes_in_rate_privileged: "10000000000",
  http_req_rate_regular: "100",
  http_req_rate_privileged: "100000",
};

export const haproxyConfigFor = (o: { userUrl: string; systemUrl: string; ps: Ports }) => {
  const user = new URL(o.userUrl);
  const system = new URL(o.systemUrl);
  return `\
global
  maxconn 32768
  log stdout format raw local0
  tune.h2.initial-window-size 1048576
  tune.h2.fe.max-concurrent-streams 256
defaults
  mode http
  log global
  timeout connect 5s
  timeout client 60s
  timeout server 60s
  timeout http-request 10s
  timeout http-keep-alive 30s
  compression algo gzip
  compression type text/html text/plain application/json
frontend default
  bind *:${portNum(o.ps.http)}
  stick-table type ip size 100k expire 10m store http_req_rate(10s),bytes_in_rate(1m)
  acl privileged_ip src,map(/etc/haproxy/privileged_ips.map) -m found
  tcp-request connection track-sc0 src
  http-request set-var(txn.sender) src,map(/etc/haproxy/privileged_ips.map)
  http-request deny deny_status 429 hdr Retry-After "60" if !privileged_ip { sc0_bytes_in_rate gt ${LIMITS.bytes_in_rate_regular} }
  http-request deny deny_status 429 hdr Retry-After "60" if privileged_ip { sc0_bytes_in_rate gt ${LIMITS.bytes_in_rate_privileged} }
  http-request deny deny_status 429 hdr Retry-After "10" if !privileged_ip { sc0_http_req_rate gt ${LIMITS.http_req_rate_regular} }
  http-request deny deny_status 429 hdr Retry-After "10" if privileged_ip { sc0_http_req_rate gt ${LIMITS.http_req_rate_privileged} }
  http-request set-var(txn.sender) src,map(/etc/haproxy/privileged_ips.map,unknown)
  http-request del-header X-Forwarded-For
  http-request set-header X-Forwarded-For %[src]
  http-request del-header X-Flashbots-Source-Name
  http-request set-header X-Flashbots-Source-Name %[var(txn.sender)]
  http-request return status 200 content-type text/plain string "OK\\n" if { path '/livez' }
  default_backend user_of
frontend system
  mode tcp
  bind *:${portNum(o.ps.system)}
  default_backend system_of
frontend prometheus
  bind *:${portNum(o.ps.metrics)}
  http-request use-service prometheus-exporter if { path /metrics }
  no log
backend user_of
  http-reuse always
  option httpchk GET /livez
  http-check expect status 200
  server user_of1 ${user.hostname}:${user.port} check inter 5s fall 3 rise 1
backend system_of
  mode tcp
  option tcp-check
  tcp-check send-binary 0200000000000000000450494E47
  tcp-check expect rstring PONG
  server system_of1 ${system.hostname}:${system.port} check inter 5s fall 3 rise 1
`;
};

export function buildContainer(def: ContainerDef, ctx: Ctx): ContainerResult {
  const flowproxy = def.refs?.flowproxy;
  if (!flowproxy) throw new Error(`haproxy ${def.name}: missing refs.flowproxy`);
  const ps: Ports = { ...ports, ...((def.config?.ports as Ports | undefined) ?? {}) };
  const cfg = haproxyConfigFor({
    userUrl: ctx.url(flowproxy, "user"),
    systemUrl: ctx.url(flowproxy, "system"),
    ps,
  });
  // devnet: nobody is privileged; production fills this map from Builder Hub
  const privileged = ((def.config?.privilegedIps as string[] | undefined) ?? []).join("\n") + "\n";
  return {
    container: {
      image: "docker.io/library/haproxy:3.0.11-alpine",
      args: ["-f", "/usr/local/etc/haproxy/haproxy.cfg"],
      ports: ps,
    },
    configs: [
      { filename: "haproxy.cfg", content: cfg, mountPath: "/usr/local/etc/haproxy/haproxy.cfg" },
      { filename: "privileged_ips.map", content: privileged, mountPath: "/etc/haproxy/privileged_ips.map" },
    ],
  };
}
