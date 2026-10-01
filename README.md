# Quiet Accounts

A home-service business's past customers and old quotes, followed up for them. The engine (`packages/engine`) reads
their exports and writes the notes; the server (`apps/server`) sends them, reads the replies and texts the owner; the
operator console (`apps/web`) is where Jack looks after it all; `apps/site` is the public site.

```sh
pnpm install
pnpm dev     # server on :8787, console on :5173 (log providers: nothing is sent)
pnpm check   # typecheck and every test
```

## Run it

**One always-on host with a disk.** The server, the worker (sending, reminders, reports, backups) and the console run
in one Node process over one SQLite file. That needs one machine that stays up with a persistent volume, and exactly
one copy of it: two would send the same notes twice. Not serverless: anything that sleeps between requests or runs
several copies stops the worker and splits the database.

- **Fly:** one Machine with a volume mounted at `/data`, `internal_port = 8787`, auto-stop off.
- **Render:** a Docker web service with a persistent disk mounted at `/data`.
- **Railway:** a service from the Dockerfile with a volume mounted at `/data`.
- **A small VPS:** Docker, with Caddy or nginx in front for https.

**Build and start.** Each host builds the `Dockerfile` at the root (Node 22, pnpm from `packageManager`; it
builds the console and runs the server and the worker together). By hand on a VPS, with Caddy or nginx on the same
machine passing https to `127.0.0.1:8787`:

```sh
docker build -t quiet-accounts .
docker run -d --restart unless-stopped -p 127.0.0.1:8787:8787 -v quiet-accounts-data:/data --env-file .env quiet-accounts
```

Publish the port on `127.0.0.1` only, as above, so every request comes through the proxy. A plain `-p 8787:8787`
opens it to the internet (Docker's ports get past ufw): anyone could skip the proxy, write their own
`X-Forwarded-For` and get round the sign-up limits, and the operator token could travel over plain http.

**Settings.** Copy `.env.example` to `.env`, or into the host's secrets, and fill in every required one. Each line
says what happens without it. The ones a deploy gets wrong:

- `PUBLIC_URL`: the https address the server is reached at. Every unsubscribe link, owner link and webhook uses it,
  and the server won't send real email or texts without https.
- `OPERATOR_TOKEN`, `APP_SECRET`, `WEBHOOK_SECRET`: long random strings (`openssl rand -hex 32`). The operator token
  signs you in to the console.
- `TRUSTED_PROXY_HOPS`: usually `1` behind the host's proxy (Fly, Render, Railway, or your Caddy), one more for each
  proxy in front of that (Cloudflare); the host's docs say. Count only proxies that every request passes through: a
  request that can skip one writes its own address. Left at 0, every sign-up looks like it comes from the proxy and
  they all share one rate limit.
- `SIGNUP_ORIGINS`: the site's origins, e.g. `https://quietaccounts.com,https://www.quietaccounts.com`. Left empty,
  any site can post the Start form.

**Webhook URLs.** `WEBHOOK_SECRET` is part of the path, so treat these URLs as secrets.

| From | URL | Set up |
| --- | --- | --- |
| Instantly: replies, bounces, unsubscribes | `PUBLIC_URL/webhooks/instantly/WEBHOOK_SECRET` | The server registers it at boot, and turns it back on if Instantly switches it off. The health page says whether it's OK. |
| Stripe: one-pass payments | `PUBLIC_URL/webhooks/stripe` | Add the endpoint in Stripe (events `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`) and put its signing secret in `STRIPE_WEBHOOK_SECRET`. Without `STRIPE_SECRET_KEY` billing is by hand. |
| Twilio: owner texts | `PUBLIC_URL/webhooks/sms/WEBHOOK_SECRET` | The number's incoming-message webhook (POST). Take CANCEL out of its opt-out keywords. |
| Inbound email: exports owners forward | `PUBLIC_URL/webhooks/inbound-email/WEBHOOK_SECRET` | Your inbound email service, posting JSON, for `INBOUND_DOMAIN`. |

**The volume and the backups.**

- The database is `/data/quiet-accounts.db` (`DATABASE_PATH`, set in the image). Mount the volume at `/data`;
  without one, every deploy starts from nothing.
- Every night from 7am UTC the worker copies it (SQLite's `VACUUM INTO`, safe while the server runs) to
  `/data/backups/quiet-accounts-YYYY-MM-DD.db` and keeps the newest 14. `BACKUP_DIR` puts them somewhere else.
- Size the volume at about 16 times the database (the database, 14 copies and room to grow), or point `BACKUP_DIR`
  at a second volume. On a disk too small for 14, a backup drops the oldest copies to make room, and when even that
  isn't enough it skips the night and the health page says so. It always leaves 64 MB for the database to write.
- They sit on the same volume, so they cover a bad change or a damaged file, not a lost disk. Turn on the host's volume
  snapshots too, or copy a backup off the host now and then.
- To restore: stop the server, copy the backup over `/data/quiet-accounts.db`, delete the `-wal` and `-shm` files
  next to it, and start it again.

**The health page.** Signed in to the console, the "Setup" box in the sidebar shows whether Instantly's webhooks are
OK and when the last one arrived, how owner texts go out (the server log, by hand or Twilio), the Stripe mode (manual,
test or live; never the key), whether Stripe's events can be checked and when the last one arrived, and the last backup. `GET /api/health/setup` with the operator token gives the same as
JSON. Point the host's own health check at `GET /api/health`, which also says whether the worker is ticking.
