export function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

export function allowedOrigins(): string[] {
  return (process.env.AI_ALLOWED_ORIGINS ?? 'https://academybugs.com')
    .split(',')
    .map(value => {
      const url = new URL(value.trim());
      const hostname = url.hostname;

      if (
        hostname.includes('*') &&
        (!hostname.startsWith('*.') || hostname.slice(2).includes('*'))
      ) {
        throw new Error(
          'An origin wildcard must use the form https://*.example.com',
        );
      }

      return url.origin;
    });
}

export function isApprovedOrigin(url: URL, origins: string[]): boolean {
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hostname.includes('*')
  ) {
    return false;
  }

  return origins.some(value => {
    const allowed = new URL(value);

    if (url.protocol !== allowed.protocol || url.port !== allowed.port)
      return false;
    if (!allowed.hostname.startsWith('*.'))
      return url.hostname === allowed.hostname;

    const suffix = allowed.hostname.slice(1);

    return url.hostname.endsWith(suffix) && url.hostname.length > suffix.length;
  });
}

export function approvedUrl(value: string, origins: string[]): string {
  const url = new URL(value);

  if (!isApprovedOrigin(url, origins)) {
    throw new Error('Target URL must belong to an AI_ALLOWED_ORIGINS entry');
  }

  return url.toString();
}
