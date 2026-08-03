const DEFAULT_ALLOWED_ORIGINS = [
  "https://gestionale.quartomovimento.it",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function configuredOrigins(): Set<string> {
  const configured = Deno.env.get("ALLOWED_ORIGINS")
    ?.split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set(configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

export function requestOrigin(request: Request): string | null {
  return request.headers.get("origin")?.replace(/\/$/, "") ?? null;
}

export function isAllowedOrigin(request: Request): boolean {
  const origin = requestOrigin(request);
  // Webhook e chiamate server-to-server non inviano Origin.
  return origin === null || configuredOrigins().has(origin);
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = requestOrigin(request);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, idempotency-key, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (origin && configuredOrigins().has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function errorResponse(
  request: Request,
  message: string,
  status = 400,
  code?: string,
): Response {
  return jsonResponse(
    request,
    { error: message, ...(code ? { code } : {}) },
    status,
  );
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  if (!isAllowedOrigin(request)) {
    return errorResponse(
      request,
      "Origin non autorizzata",
      403,
      "origin_denied",
    );
  }
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function requirePost(request: Request): Response | null {
  if (request.method !== "POST") {
    return errorResponse(
      request,
      "Metodo non consentito",
      405,
      "method_not_allowed",
    );
  }
  if (!isAllowedOrigin(request)) {
    return errorResponse(
      request,
      "Origin non autorizzata",
      403,
      "origin_denied",
    );
  }
  return null;
}

export async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("content_type");
  }
  return await request.json() as T;
}

export function publicError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Errore inatteso";
}
