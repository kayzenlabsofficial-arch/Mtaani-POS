interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const url = new URL(request.url);
  const trackingId = url.searchParams.get('OrderTrackingId') || '';
  const reference = url.searchParams.get('OrderMerchantReference') || '';

  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PesaPal Payment</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; }
      main { width: min(92vw, 420px); border: 1px solid #e2e8f0; background: white; padding: 28px; border-radius: 12px; box-shadow: 0 18px 50px rgba(15, 23, 42, .08); }
      h1 { margin: 0; font-size: 24px; }
      p { color: #475569; line-height: 1.5; }
      code { display: block; margin-top: 14px; overflow-wrap: anywhere; color: #0369a1; }
    </style>
  </head>
  <body>
    <main>
      <h1>PesaPal checkout complete</h1>
      <p>You can return to Mtaani POS. The cashier screen will confirm the final payment status automatically.</p>
      ${trackingId ? `<code>${trackingId}</code>` : ''}
      ${reference ? `<code>${reference}</code>` : ''}
    </main>
  </body>
</html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
