import type { NetworkTransport } from "@/types/domain";

/**
 * The two transports a profile chooses between. SSH Tunnel and Proxy are
 * mutually exclusive — a profile carries one — but the detail pane holds a
 * working copy of both so switching tabs to look never costs the other one's
 * edits, so the two shapes get names of their own.
 */
export type SshTransport = Extract<NetworkTransport, { type: "ssh-tunnel" }>;
export type SocksTransport = Extract<NetworkTransport, { type: "socks5" }>;
export type TransportKind = NetworkTransport["type"];

/** A blank SSH transport. `host` doubles as the ~/.ssh/config alias in that mode. */
export function defaultSshTransport(host = ""): SshTransport {
  return {
    type: "ssh-tunnel",
    host,
    port: 22,
    username: "root",
    authMethod: "password",
    credentialsSaved: false
  };
}

/** A blank SOCKS5 transport — the proxy most often runs on this machine. */
export function defaultSocksTransport(host = "127.0.0.1"): SocksTransport {
  return { type: "socks5", host, port: 1080, credentialsSaved: false };
}

/** The short word the profile list tags a profile with. */
export function transportLabel(transport: NetworkTransport): string {
  return transport.type === "ssh-tunnel" ? "SSH" : "Proxy";
}
