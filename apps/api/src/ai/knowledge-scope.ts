export function knowledgePath(path: string): string {
  return (
    new URL(path, 'https://knowledge.invalid').pathname.replace(/\/+$/, '') ||
    '/'
  );
}

export function coversKnowledgePath(scope: string, path: string): boolean {
  const parent = knowledgePath(scope);
  const child = knowledgePath(path);

  return parent === '/' || parent === child || child.startsWith(`${parent}/`);
}

export function commonKnowledgePath(urls: URL[]): string {
  const segments = urls[0].pathname.split('/').filter(Boolean);

  while (
    segments.length &&
    urls.some(
      url => !coversKnowledgePath(`/${segments.join('/')}`, url.pathname),
    )
  ) {
    segments.pop();
  }

  return segments.length ? `/${segments.join('/')}` : '/';
}
