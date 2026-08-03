import {
  errorResponse,
  handlePreflight,
  jsonResponse,
  publicError,
  requirePost,
} from "../_shared/http.ts";
import { paypalRequest } from "../_shared/paypal.ts";
import { serviceClient } from "../_shared/supabase.ts";

interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource: Record<string, unknown>;
  [key: string]: unknown;
}

interface VerificationResponse {
  verification_status: "SUCCESS" | "FAILURE";
}

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (!value) throw new Error(`header_missing:${name}`);
  return value;
}

function validateCertificateUrl(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com"))
  ) {
    throw new Error("invalid_cert_url");
  }
}

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const methodError = requirePost(request);
  if (methodError) return methodError;

  try {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > 1_000_000) {
      return errorResponse(request, "Payload troppo grande", 413);
    }

    const rawBody = await request.text();
    if (rawBody.length > 1_000_000) {
      return errorResponse(request, "Payload troppo grande", 413);
    }

    let event: PayPalWebhookEvent;
    try {
      event = JSON.parse(rawBody) as PayPalWebhookEvent;
    } catch {
      return errorResponse(request, "JSON non valido", 400, "invalid_json");
    }
    if (
      !event?.id ||
      !event.event_type ||
      !event.resource ||
      typeof event.resource !== "object"
    ) {
      return errorResponse(request, "Evento PayPal non valido", 400);
    }

    const transmissionId = requiredHeader(request, "paypal-transmission-id");
    const transmissionTime = requiredHeader(
      request,
      "paypal-transmission-time",
    );
    const transmissionSignature = requiredHeader(
      request,
      "paypal-transmission-sig",
    );
    const certificateUrl = requiredHeader(request, "paypal-cert-url");
    const authAlgorithm = requiredHeader(request, "paypal-auth-algo");
    validateCertificateUrl(certificateUrl);

    const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
    if (!webhookId) throw new Error("Secret PAYPAL_WEBHOOK_ID mancante");

    const verification = await paypalRequest<VerificationResponse>(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: JSON.stringify({
          auth_algo: authAlgorithm,
          cert_url: certificateUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSignature,
          transmission_time: transmissionTime,
          webhook_id: webhookId,
          webhook_event: event,
        }),
      },
    );
    if (verification.verification_status !== "SUCCESS") {
      console.warn("paypal-webhook: firma non valida", event.id);
      return errorResponse(request, "Firma PayPal non valida", 401);
    }

    const admin = serviceClient();
    const { data: processed, error } = await admin.rpc(
      "process_paypal_webhook",
      {
        p_event_id: event.id,
        p_event_type: event.event_type,
        p_resource: event.resource,
        p_payload: event,
      },
    );
    if (error) throw error;

    // Anche i duplicati ricevono 200: PayPal non deve ritentarli.
    return jsonResponse(request, {
      ok: true,
      processed: Boolean(processed),
      duplicate: processed === false,
    });
  } catch (error) {
    const message = publicError(error);
    if (
      message.startsWith("header_missing:") ||
      message === "invalid_cert_url"
    ) {
      return errorResponse(request, "Header PayPal non validi", 400);
    }
    console.error("paypal-webhook:", message);
    // Il 500 induce PayPal a ritentare; la RPC è atomica e idempotente.
    return errorResponse(request, "Evento non elaborato", 500);
  }
});
