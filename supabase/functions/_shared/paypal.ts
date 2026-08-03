export interface PayPalAccessToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export class PayPalApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PayPalApiError";
    this.status = status;
  }
}

export function paypalBaseUrl(): string {
  const environment = (Deno.env.get("PAYPAL_ENVIRONMENT") ?? "sandbox")
    .toLowerCase();
  if (environment === "live") return "https://api-m.paypal.com";
  if (environment !== "sandbox") {
    throw new Error("PAYPAL_ENVIRONMENT deve essere sandbox oppure live");
  }
  return "https://api-m.sandbox.paypal.com";
}

function paypalCredentials(): { clientId: string; secret: string } {
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
  const secret = Deno.env.get("PAYPAL_CLIENT_SECRET");
  if (!clientId || !secret) throw new Error("Credenziali PayPal mancanti");
  return { clientId, secret };
}

async function paypalError(response: Response): Promise<PayPalApiError> {
  let detail = "";
  try {
    const payload = await response.json();
    detail = String(payload?.message ?? payload?.name ?? "");
  } catch {
    detail = await response.text().catch(() => "");
  }
  // Non includere header o credenziali nelle risposte/log.
  return new PayPalApiError(
    response.status,
    `PayPal ${response.status}${detail ? `: ${detail}` : ""}`,
  );
}

export async function paypalAccessToken(): Promise<string> {
  const { clientId, secret } = paypalCredentials();
  const encoded = btoa(`${clientId}:${secret}`);
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${encoded}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw await paypalError(response);
  const payload = await response.json() as PayPalAccessToken;
  if (!payload.access_token) throw new Error("Token PayPal non valido");
  return payload.access_token;
}

export async function paypalRequest<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const token = await paypalAccessToken();
  const response = await fetch(`${paypalBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw await paypalError(response);
  return await response.json() as T;
}

export function centsToPayPalValue(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Importo non valido");
  }
  return (cents / 100).toFixed(2);
}

export function paypalValueToCents(value: string): number {
  if (!/^\d+\.\d{2}$/.test(value)) throw new Error("Importo PayPal non valido");
  const [units, decimals] = value.split(".");
  const cents = Number(units) * 100 + Number(decimals);
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Importo PayPal non valido");
  }
  return cents;
}
