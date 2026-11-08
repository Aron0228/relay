import {allowedOrigins, approvedUrl, isApprovedOrigin} from './config';

export function normalizeEnvironmentOrigin(value: string): string {
  const url = new URL(value.trim());
  const domain = url.hostname;

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (domain.includes('*') &&
      (!domain.startsWith('*.') || domain.slice(2).includes('*')))
  ) {
    throw new Error('Use an HTTP(S) origin such as https://*.up.railway.app');
  }

  const permitted = allowedOrigins().some(origin => {
    const parent = new URL(origin);
    if (parent.protocol !== url.protocol || parent.port !== url.port)
      return false;
    if (!domain.startsWith('*.')) return isApprovedOrigin(url, [parent.origin]);
    if (!parent.hostname.startsWith('*.')) return false;

    const child = domain.slice(2);
    const ancestor = parent.hostname.slice(2);

    return child === ancestor || child.endsWith(`.${ancestor}`);
  });

  if (!permitted)
    throw new Error(
      'Environment origins must be allowed by AI_ALLOWED_ORIGINS',
    );

  return url.origin;
}

export function environmentTarget(
  environment: {baseUrl?: string | null; allowedOrigins?: string[]},
  requestedUrl?: string,
): string {
  const value = requestedUrl ?? environment.baseUrl;

  if (!value)
    throw new Error('This environment requires a concrete target URL');

  const target = approvedUrl(value, allowedOrigins());
  const matchesBase =
    environment.baseUrl && new URL(environment.baseUrl).toString() === target;
  const matchesRule = isApprovedOrigin(
    new URL(target),
    environment.allowedOrigins ?? [],
  );

  if (!matchesBase && !matchesRule)
    throw new Error('Target URL is not allowed by this environment');

  return target;
}
