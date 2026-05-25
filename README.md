# Smart POS

Simple single-shop POS for local retail businesses.

## Local Development

```bash
npm install
npm run dev
npm run wrangler:dev
```

The Vite app runs on `http://localhost:3000` and proxies API calls to the Wrangler Pages server on `http://localhost:8788`.

## Database

```bash
npm run d1:local
npm run d1:setup
```

For a full destructive reset:

```bash
npm run d1:hard-reset:local
npm run d1:hard-reset:remote
```

The app uses one business record at a time, with tills and shifts handling cashier sessions.

## Environment

Copy `.env.example` to `.dev.vars` for local Pages Functions secrets.

Set `BUSINESS_BOOTSTRAP_PASSWORD` as a Cloudflare secret before creating or resetting business users. Super admin screens never display this password; share it with the owner outside the app.

Platform billing STK pushes use the `BILLING_MPESA_*` Cloudflare secrets. These are separate from each business's sales M-Pesa settings.
