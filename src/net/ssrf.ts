// SSRF 対策: 外部取得はすべてここを通す。リダイレクト先・ブラウザの追加通信にも適用する。
import net from 'node:net';
import dns from 'node:dns/promises';

const blockV4 = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as [string, number][]) blockV4.addSubnet(a, p, 'ipv4');

const blockV6 = new net.BlockList();
for (const [a, p] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96],
  ['2001:db8::', 32], ['100::', 64], ['2002::', 16],
] as [string, number][]) blockV6.addSubnet(a, p, 'ipv6');

export function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return blockV4.check(ip, 'ipv4');
  if (v === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blockV4.check(mapped[1], 'ipv4');
    if (/^::ffff:/.test(lower)) return true;
    return blockV6.check(ip, 'ipv6');
  }
  return true;
}

/** RFC 2606 の予約 TLD。架空企業の固定サイト（ネットワーク通信なし）に使う */
export function isFixtureHost(host: string): boolean {
  return /\.example$/i.test(host);
}

export class BlockedUrlError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BlockedUrlError';
  }
}

export interface ValidatedTarget {
  url: URL;
  fixture: boolean;
  address?: string;
  family?: number;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

const defaultResolver: Resolver = (host) => dns.lookup(host, { all: true, verbatim: true });

export async function validateTarget(rawUrl: string, resolver: Resolver = defaultResolver): Promise<ValidatedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError('URL の形式が不正です');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError(`許可されないスキーム: ${url.protocol}`);
  if (url.username || url.password) throw new BlockedUrlError('認証情報付き URL は使用できません');
  if (url.port && url.port !== '80' && url.port !== '443') throw new BlockedUrlError(`許可されないポート: ${url.port}`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isFixtureHost(host)) return { url, fixture: true };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new BlockedUrlError('ローカル／内部ホストへの接続は禁止されています');
  }
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new BlockedUrlError('内部 IP アドレスへの接続は禁止されています');
    return { url, fixture: false, address: host, family: net.isIP(host) };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await resolver(host);
  } catch {
    throw new BlockedUrlError(`名前解決できません: ${host}`);
  }
  if (!addrs.length) throw new BlockedUrlError(`名前解決できません: ${host}`);
  // 1 つでも内部アドレスを含むなら拒否（DNS リバインディング対策）
  if (addrs.some((a) => isBlockedIp(a.address))) throw new BlockedUrlError('内部 IP に解決されるホストは禁止されています');
  return { url, fixture: false, address: addrs[0].address, family: addrs[0].family };
}
