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

  // Verify password (Simple for now, will implement WebCrypto hashing in next step)
  // For initial migration, we accept the plain password if it matches the hash or if it's the seed admin
  if (user.password !== password) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), { status: 401 });
  }

  // Return user info (In a real app, generate a JWT here)
  return new Response(JSON.stringify({
    id: user.id,
    name: user.name,
    role: user.role,
    token: crypto.randomUUID() // Dummy token for session
  }));
};
