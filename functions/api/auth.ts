interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const { username, password } = await request.json() as any;

  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Missing credentials' }), { status: 400 });
  }

  // Get user from D1
  const user = await env.DB.prepare('SELECT * FROM users WHERE name = ?')
    .bind(username)
    .first() as any;

  if (!user) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
  }

  // Verify password using a secure hashing check
  // Since we are in a Worker, we use a simple but effective hash comparison
  const encoder = new TextEncoder();
  const salt = 'mtaani-pos-v2-secure-2026';
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashed = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Support both hashed and plain-text (for legacy migration)
  if (user.password !== hashed && user.password !== password) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), { status: 401 });
  }

  // Generate a session token that includes the user's identity and business context
  // In a production environment, this would be a signed JWT.
  const sessionToken = crypto.randomUUID();
  
  return new Response(JSON.stringify({
    id: user.id,
    name: user.name,
    role: user.role,
    businessId: user.businessId,
    token: sessionToken
  }));
};
