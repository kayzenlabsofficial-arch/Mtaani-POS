interface Env {
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
    ...corsHeaders,
    // Ensure the browser/SW doesn't cache secrets
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;

  return new Response(
    JSON.stringify({
      apiKey: env.API_SECRET ? env.API_SECRET : null,
    }),
    { headers: jsonHeaders() }
  );
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { headers: corsHeaders });
};

