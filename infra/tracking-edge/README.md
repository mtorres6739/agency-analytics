# Tracking edge installer

This deploys the agency analytics tracker to Cloudflare-proxied websites without changing their Vercel or WordPress source. A small site-scoped Worker proxies analytics through a same-origin path and injects the site-specific script into public HTML responses.

## Safety model

- Every hostname and Rybbit site ID must appear in `site-manifest.json`; there is no wildcard deployment.
- `plan` blocks unproxied DNS and existing Worker route conflicts.
- Site-scoped Worker names prevent a partial client rollout from overwriting another client's hostname mapping.
- The Worker skips WordPress admin/login/REST paths, application APIs, Next.js assets, and non-HTML responses.
- Existing Rybbit tags are detected to prevent duplicates.
- Same-origin proxying reduces CSP and ad-blocker failures. Nonce-based CSP is reused when the origin emits a script nonce; injection is skipped if a nonce is required but unavailable.
- A failed multi-site apply removes any routes created by that run.
- `rollback` removes only routes attached to this Worker and leaves the origin untouched.

## Required credential scope

Use a dedicated Cloudflare API token with:

- Account: Workers Scripts Edit
- Zone: Zone Read
- Zone: DNS Read
- Zone: Workers Routes Edit

Set it server-side as `CLOUDFLARE_API_TOKEN`. The local operator also accepts the existing `CLOUDFLARE_API` variable. `CF_ACCOUNT_ID` is required. Never commit either value.

The production operator token created on Mathew's workstation is stored in macOS Keychain under service `agency-analytics-cloudflare-tracking-edge`; its secret is not in `secrets.env`. The token covers the active zones that existed when it was created. Add newly created Cloudflare zones to the token before deploying tracking there.

## Use

```bash
cd infra/tracking-edge
cp site-manifest.example.json site-manifest.json
# Replace example.com and 123 with an exact production hostname and Rybbit site ID.
npm test
npm run plan:keychain
npm run apply:keychain
npm run verify
```

Rollback all routes from the manifest:

```bash
npm run rollback:keychain
```

Custom locations are supported:

```bash
node scripts/manage.mjs plan --manifest /absolute/path/sites.json --script-name bold-analytics-tracker
```

After `verify` passes, open the website in a real browser and use **Verify** on the client page in Agency Analytics. The edge check proves installation and proxy routing; the application check proves ClickHouse received a browser event.

## Fallbacks

- A hostname that is not proxied through Cloudflare needs a source-level Vercel installation or a WordPress plugin.
- WordPress can install and activate the public `integrate-rybbit` plugin through `/wp-json/wp/v2/plugins` using an HTTPS Application Password, but its site ID and self-hosted script URL are not exposed through the WordPress REST settings endpoint. That final configuration remains manual unless the host also provides WP-CLI/SFTP access or a managed connector plugin is installed once.
- A Vercel environment variable alone cannot inject browser code. For a source fallback, add the Rybbit script to the repository layout, push a preview branch, verify it, and then merge to the production branch.
