import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2.49.8";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret ${name} mancante`);
  return value;
}

function keyFromBundle(name: string): string | null {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const bundle = JSON.parse(raw) as Record<string, unknown>;
    const value = bundle.default;
    return typeof value === "string" && value ? value : null;
  } catch {
    throw new Error(`${name} non è un JSON di chiavi valido`);
  }
}

function publishableKey(): string {
  return keyFromBundle("SUPABASE_PUBLISHABLE_KEYS") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    requiredEnv("SUPABASE_ANON_KEY");
}

function secretKey(): string {
  return keyFromBundle("SUPABASE_SECRET_KEYS") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function serviceClient(): SupabaseClient {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    secretKey(),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { "X-Client-Info": "quartomovimento-edge/1.0" } },
    },
  );
}

export async function authenticatedUser(
  request: Request,
): Promise<{ user: User; client: SupabaseClient }> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    throw new Error("auth_missing");
  }

  const client = createClient(
    requiredEnv("SUPABASE_URL"),
    publishableKey(),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("auth_invalid");
  return { user: data.user, client };
}

export async function userIsAdmin(
  client: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("profiles")
    .select("role,is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.role === "admin" && data.is_active === true;
}

export async function userCanAccessFamily(
  client: SupabaseClient,
  userId: string,
  familyId: string,
): Promise<boolean> {
  if (await userIsAdmin(client, userId)) return true;
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.is_active) return false;

  const { data, error } = await client
    .from("family_users")
    .select("family_id,families!inner(is_active)")
    .eq("user_id", userId)
    .eq("family_id", familyId)
    .eq("families.is_active", true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
