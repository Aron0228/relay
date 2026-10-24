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
    .map(value => new URL(value.trim()).origin);
}

export function approvedUrl(value: string, origins: string[]): string {
  const url = new URL(value);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !origins.includes(url.origin)
  ) {
    throw new Error('Target URL must belong to an AI_ALLOWED_ORIGINS entry');
  }

  return url.toString();
}
