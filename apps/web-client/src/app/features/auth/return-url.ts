const RETURN_URL_KEY = 'relay.issueReturnUrl';

export function rememberIssueUrl(url: string) {
  if (!(url.startsWith('/issues/') || url.startsWith('/pull-requests/'))) return;

  try {
    sessionStorage.setItem(RETURN_URL_KEY, url);
  } catch {
    /* Sign-in remains available without browser storage. */
  }
}

export function consumeIssueUrl(): string | null {
  try {
    const url = sessionStorage.getItem(RETURN_URL_KEY);
    sessionStorage.removeItem(RETURN_URL_KEY);
    return url && (url.startsWith('/issues/') || url.startsWith('/pull-requests/')) ? url : null;
  } catch {
    return null;
  }
}
