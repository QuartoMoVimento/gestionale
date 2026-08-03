import {
  errorResponse,
  handlePreflight,
  jsonResponse,
  publicError,
  readJson,
  requirePost,
} from "../_shared/http.ts";
import {
  authenticatedUser,
  serviceClient,
  userCanAccessFamily,
} from "../_shared/supabase.ts";
import { paypalRequest, paypalValueToCents } from "../_shared/paypal.ts";

interface CaptureOrderRequest {
  order_id: string;
}

interface PayPalCapture {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
}

interface PayPalOrder {
  id: string;
  status: string;
  purchase_units?: Array<{
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: { captures?: PayPalCapture[] };
  }>;
}

interface CaptureReservation {
  acquired: boolean;
  reason: string;
  payment?: {
    invoice_id: string;
    amount_cents: number;
    currency: string;
    provider_capture_id?: string | null;
    provider_status?: string | null;
  };
}

const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function findCapture(order: PayPalOrder): PayPalCapture | null {
  for (const unit of order.purchase_units ?? []) {
    for (const capture of unit.payments?.captures ?? []) {
      if (capture.id && capture.amount?.value) return capture;
    }
  }
  return null;
}

async function captureOrRecover(orderId: string): Promise<PayPalOrder> {
  try {
    return await paypalRequest<PayPalOrder>(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: "POST",
        headers: {
          "PayPal-Request-Id": `capture-${orderId}`.slice(0, 108),
          "Prefer": "return=representation",
        },
        body: "{}",
      },
    );
  } catch (captureError) {
    // Se PayPal ha catturato ma la prima risposta è andata persa, GET consente
    // di riconciliare senza effettuare una seconda cattura.
    try {
      const recovered = await paypalRequest<PayPalOrder>(
        `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        { method: "GET" },
      );
      if (findCapture(recovered)) return recovered;
    } catch {
      // Conserva l'errore della cattura, più utile per il log operativo.
    }
    throw captureError;
  }
}

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const methodError = requirePost(request);
  if (methodError) return methodError;

  try {
    const { user } = await authenticatedUser(request);
    let body: CaptureOrderRequest;
    try {
      body = await readJson<CaptureOrderRequest>(request);
    } catch {
      return errorResponse(request, "JSON non valido", 400, "invalid_json");
    }
    const orderId = String(body.order_id ?? "").trim();
    if (!ORDER_ID_PATTERN.test(orderId)) {
      return errorResponse(request, "Ordine non valido", 400, "invalid_order");
    }

    const admin = serviceClient();
    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .select(
        "id,invoice_id,family_id,amount_cents,currency,status,provider_order_id,provider_capture_id,provider_status",
      )
      .eq("provider", "paypal")
      .eq("provider_order_id", orderId)
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) {
      return errorResponse(
        request,
        "Ordine non trovato",
        404,
        "order_not_found",
      );
    }
    if (!await userCanAccessFamily(admin, user.id, payment.family_id)) {
      return errorResponse(request, "Ordine non accessibile", 403, "forbidden");
    }
    if (payment.status === "completed" && payment.provider_capture_id) {
      return jsonResponse(request, {
        order_id: orderId,
        capture_id: payment.provider_capture_id,
        status: payment.provider_status ?? "COMPLETED",
        already_captured: true,
      });
    }
    if (
      ["cancelled", "refunded", "partially_refunded"].includes(payment.status)
    ) {
      return errorResponse(
        request,
        "Ordine non catturabile nello stato corrente",
        409,
        "invalid_payment_state",
      );
    }

    const { data: reservation, error: reservationError } = await admin.rpc(
      "begin_paypal_capture",
      {
        p_order_id: orderId,
        p_stale_after_seconds: 120,
      },
    );
    if (reservationError) throw reservationError;
    const reserved = reservation as CaptureReservation | null;
    if (!reserved?.acquired) {
      if (reserved?.reason === "already_completed" && reserved.payment) {
        return jsonResponse(request, {
          order_id: orderId,
          capture_id: reserved.payment.provider_capture_id,
          status: reserved.payment.provider_status ?? "COMPLETED",
          already_captured: true,
        });
      }
      return errorResponse(
        request,
        reserved?.reason === "capture_in_progress"
          ? "Acquisizione PayPal già in corso"
          : "Il saldo è cambiato o il checkout non è più valido",
        409,
        reserved?.reason ?? "capture_not_acquired",
      );
    }
    const reservedPayment = reserved.payment ?? payment;

    let order: PayPalOrder;
    try {
      order = await captureOrRecover(orderId);
    } catch (captureError) {
      const { error: releaseError } = await admin.rpc(
        "release_paypal_capture",
        {
          p_order_id: orderId,
          p_provider_status: "RETRYABLE_CAPTURE_ERROR",
        },
      );
      if (releaseError) {
        console.error("paypal-capture-order release:", releaseError.message);
      }
      throw captureError;
    }
    if (order.id !== orderId) {
      throw new Error("Identificativo ordine non coerente");
    }
    const unit = order.purchase_units?.[0];
    if (unit?.custom_id !== reservedPayment.invoice_id) {
      throw new Error("Riferimento interno PayPal non coerente");
    }
    const capture = findCapture(order);
    if (!capture) throw new Error("Cattura PayPal assente dalla risposta");
    const amountCents = paypalValueToCents(capture.amount.value);
    const currency = capture.amount.currency_code.toUpperCase();
    if (
      amountCents !== reservedPayment.amount_cents ||
      currency !== reservedPayment.currency
    ) {
      throw new Error("Importo o valuta PayPal non coerenti");
    }

    const { data: recorded, error: recordError } = await admin.rpc(
      "record_paypal_capture",
      {
        p_order_id: orderId,
        p_capture_id: capture.id,
        p_capture_status: capture.status,
        p_amount_cents: amountCents,
        p_currency: currency,
        p_payload: order,
      },
    );
    if (recordError) throw recordError;

    return jsonResponse(request, {
      order_id: orderId,
      capture_id: capture.id,
      status: capture.status,
      payment_status: recorded?.status,
      invoice_id: reservedPayment.invoice_id,
      already_captured: false,
    });
  } catch (error) {
    const message = publicError(error);
    if (message === "auth_missing" || message === "auth_invalid") {
      return errorResponse(request, "Sessione non valida", 401, "unauthorized");
    }
    console.error("paypal-capture-order:", message);
    return errorResponse(
      request,
      "Impossibile acquisire il pagamento PayPal",
      502,
    );
  }
});
