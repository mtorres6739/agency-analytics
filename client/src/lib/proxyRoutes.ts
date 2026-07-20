export const BUILT_IN_SINGLE_SEGMENT_ROUTES = new Set([
  "login",
  "two-factor",
  "signup",
  "subscribe",
  "invitation",
  "reset-password",
  "auth",
  "admin",
  "organization",
  "account",
  "uptime",
  "settings",
  "rollup",
  "portfolio",
  "clients",
  "reports",
  "as",
  "_next",
  "api",
  "widget",
]);

export function getCanonicalSitePath(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)$/);
  if (!match) return null;

  const siteId = match[1];
  if (BUILT_IN_SINGLE_SEGMENT_ROUTES.has(siteId)) return null;

  return `/${siteId}/main`;
}
