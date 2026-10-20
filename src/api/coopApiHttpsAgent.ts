import * as dns from "node:dns";
import * as https from "node:https";
import * as net from "node:net";
import type { LookupFunction } from "node:net";

const COOP_DOH_PROVIDERS = [
  {
    address: "1.1.1.1",
    servername: "cloudflare-dns.com",
    path: (hostname: string) => `/dns-query?name=${encodeURIComponent(hostname)}&type=A`
  },
  {
    address: "8.8.8.8",
    servername: "dns.google",
    path: (hostname: string) => `/resolve?name=${encodeURIComponent(hostname)}&type=A`
  }
] as const;

type DnsJsonResponse = {
  Answer?: Array<{ type?: number; data?: string }>;
};

type LookupDependencies = {
  systemLookup?: LookupFunction;
  resolveCoopIpv4?: (hostname: string) => Promise<string[]>;
};

export function isCoopApiHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return normalized === "api.coop-ai.dev";
}

function resolveWithDohProvider(
  hostname: string,
  provider: (typeof COOP_DOH_PROVIDERS)[number]
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: provider.address,
        servername: provider.servername,
        path: provider.path(hostname),
        headers: {
          Accept: "application/dns-json",
          Host: provider.servername
        },
        timeout: 3_000
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (body.length <= 64_000) {
            body += chunk;
          }
        });
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`DNS-over-HTTPS returned ${response.statusCode ?? "an error"}.`));
            return;
          }
          try {
            const payload = JSON.parse(body) as DnsJsonResponse;
            const addresses = (payload.Answer ?? [])
              .filter((answer) => answer.type === 1 && typeof answer.data === "string")
              .map((answer) => answer.data as string)
              .filter((address) => net.isIPv4(address));
            if (addresses.length === 0) {
              reject(new Error("DNS-over-HTTPS returned no IPv4 address."));
              return;
            }
            resolve(addresses);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("DNS-over-HTTPS timed out.")));
  });
}

async function defaultCoopResolver(hostname: string): Promise<string[]> {
  let lastError: unknown;
  for (const provider of COOP_DOH_PROVIDERS) {
    try {
      return await resolveWithDohProvider(hostname, provider);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Coop API address lookup failed.");
}

/**
 * VS Code's extension host normally uses the Mac resolver. Some routers return
 * intermittent NXDOMAIN/timeouts even while browsers using Secure DNS work.
 * For Coop's production API only, resolve over HTTPS by IP without changing the
 * user's system settings, then fall back to the system resolver. TLS validates
 * both the resolver and api.coop-ai.dev normally.
 */
export function createCoopApiLookup(dependencies: LookupDependencies = {}): LookupFunction {
  const lookup = dependencies.systemLookup ?? (dns.lookup as LookupFunction);
  const resolveCoopIpv4 = dependencies.resolveCoopIpv4 ?? defaultCoopResolver;

  return (hostname, options, callback) => {
    if (!isCoopApiHostname(hostname)) {
      lookup(hostname, options, callback);
      return;
    }

    void resolveCoopIpv4(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          lookup(hostname, options, callback);
          return;
        }
        if (options.all) {
          callback(null, addresses.map((address) => ({ address, family: 4 })));
          return;
        }
        callback(null, addresses[0], 4);
      },
      () => lookup(hostname, options, callback)
    );
  };
}

export const coopApiHttpsAgent = new https.Agent({
  keepAlive: true,
  lookup: createCoopApiLookup()
});
