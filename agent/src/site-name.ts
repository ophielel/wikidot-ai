/**
 * Accept a UNIX name, a `*.wikidot.com` host or a full URL and return the UNIX
 * name the Wikidot API expects.
 *
 * `Site.fromUnixName` builds `http://<name>.wikidot.com`, so passing
 * `https://scp-wiki.wikidot.com/` produces an invalid URL. Normalising here
 * means the CLI, the config file and the web form all accept the same shapes.
 */
export function normalizeSiteName(input: string): string {
  let value = input.trim();
  if (!value) return value;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  value = value.split(/[/?#]/)[0] ?? value;
  value = value.replace(/^[^@/]*@/, '');
  value = value.replace(/:\d+$/, '');
  value = value.replace(/^www\./i, '');
  value = value.replace(/\.wikidot\.com$/i, '');
  return value.toLowerCase();
}

/** True when the raw input looked like a URL or host rather than a UNIX name. */
export function looksLikeUrl(input: string): boolean {
  const value = input.trim();
  return /:\/\//.test(value) || /\.wikidot\.com/i.test(value) || /^www\./i.test(value);
}
