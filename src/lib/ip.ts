import ipaddr from 'ipaddr.js';

export const IP_ADDRESS_HEADERS = [
  'true-client-ip', // CDN
  'cf-connecting-ip', // Cloudflare
  'fastly-client-ip', // Fastly
  'x-nf-client-connection-ip', // Netlify
  'do-connecting-ip', // Digital Ocean
  'x-real-ip', // Reverse proxy
  'x-appengine-user-ip', // Google App Engine
  'x-forwarded-for',
  'forwarded',
  'x-client-ip',
  'x-cluster-client-ip',
  'x-forwarded',
];

export function getIpAddress(headers: Headers) {
  const customHeader = process.env.CLIENT_IP_HEADER;

  if (customHeader && headers.get(customHeader)) {
    return headers.get(customHeader);
  }

  const header = IP_ADDRESS_HEADERS.find(name => {
    return headers.get(name);
  });

  const ip = headers.get(header);

  if (header === 'x-forwarded-for') {
    return ip?.split(',')?.[0]?.trim();
  }

  if (header === 'forwarded') {
    const match = ip.match(/for=(\[?[0-9a-fA-F:.]+\]?)/);

    if (match) {
      return match[1];
    }
  }

  return ip;
}

/**
 * Anonymize an IP address for GDPR compliance.
 * IPv4: zeroes the last octet (1.2.3.4 → 1.2.3.0)
 * IPv6: keeps top 48 bits, zeroes the rest
 * Controlled by ANONYMIZE_IPS env var (default: true).
 */
export function anonymizeIp(ip: string): string {
  if (!ip || process.env.ANONYMIZE_IPS === 'false') return ip;

  try {
    const addr = ipaddr.parse(stripPort(ip));
    if (addr.kind() === 'ipv4') {
      const bytes = addr.toByteArray();
      bytes[3] = 0;
      return ipaddr.fromByteArray(bytes).toString();
    }
    // IPv6: keep first 48 bits, zero the rest
    const bytes = addr.toByteArray();
    for (let i = 6; i < 16; i++) bytes[i] = 0;
    return ipaddr.fromByteArray(bytes).toString();
  } catch {
    return ip;
  }
}

export function stripPort(ip: string) {
  if (ip.startsWith('[')) {
    const endBracket = ip.indexOf(']');
    if (endBracket !== -1) {
      return ip.slice(0, endBracket + 1);
    }
  }

  const idx = ip.lastIndexOf(':');
  if (idx !== -1) {
    if (ip.includes('.') || /^[a-zA-Z0-9.-]+$/.test(ip.slice(0, idx))) {
      return ip.slice(0, idx);
    }
  }

  return ip;
}
