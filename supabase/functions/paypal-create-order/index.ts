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
import {
  centsToPayPalValue,
  PayPalApiError,
  paypalRequest,
  paypalValueToCents,
} from "../_shared/paypal.ts";

interface CreateOrderRequest {
  invoice_id: string;
  request_id?: string;
}

interface PayPalOrder {
  id: string;
  status: string;
  create_time?: string;
  purchase_units?: Array<{
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
        amount: { currency_code: string; value: string };
      }>;
    };
  }>;
  links?: Array<{ href: string; rel: string; method: string }>;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,80}$/;
const REUSABLE_ORDER_STATUSES = new Set([
  "CREATED",
  "APPROVED",
  "PAYER_ACTION_REQUIRED",
  "SAVED",
]);

function approvalUrl(order: PayPalOrder): string | null {
  return order.links?.find((link) => link.rel === "approve")?.href ?? null;
}

function maxOrderAgeMs(): number {
  const configured = Number(
    Deno.env.get("PAYPAL_ORDER_MAX_AGE_MINUTES") ?? "165",
  );
  const minutes = Number.isFinite(configured)
    ? Math.min(Math.max(configured, 15), 180)
    : 165;
  return minutes * 60_000;
}

function orderIsFresh(createdAt: string): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && Date.now() - created < maxOrderAgeMs();
}

function firstCapture(order: PayPalOrder) {
  return order.purchase_units?.flatMap((unit) =>
    unit.payments?.captures ?? []
  )[0] ?? null;
}

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const methodError = requirePost(request);
  if (methodError) return methodError;

  try {
    const { user } = await authenticatedUser(request);
    let body: CreateOrderRequest;
    try {
      body = await readJson<CreateOrderRequest>(request);
    } catch {
      return errorResponse(request, "JSON non valido", 400, "invalid_json");
    }

    const invoiceId = String(body.invoice_id ?? "").trim();
    if (!UUID_PATTERN.test(invoiceId)) {
      return errorResponse(
        request,
        "Scadenza non valida",
        400,
        "invalid_invoice",
      );
    }

    const clientRequestId = String(
      request.headers.get("idempotency-key") ?? body.request_id ?? "",
    ).trim();
    if (clientRequestId && !REQUEST_ID_PATTERN.test(clientRequestId)) {
      return errorResponse(
        request,
        "Chiave di idempotenza non valida",
        400,
        "invalid_idempotency_key",
      );
    }

    const admin = serviceClient();
    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("id,family_id,number,title,total_cents,currency,status")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice || ["draft", "void", "processing"].includes(invoice.status)) {
      return errorResponse(
        request,
        "Scadenza non pagabile",
        404,
        "not_payable",
      );
    }
    if (!await userCanAccessFamily(admin, user.id, invoice.family_id)) {
      return errorResponse(
        request,
        "Scadenza non accessibile",
        403,
        "forbidden",
      );
    }

    const { data: movements, error: movementsError } = await admin
      .from("payments")
      .select("amount_cents,refunded_cents,status")
      .eq("invoice_id", invoiceId);
    if (movementsError) throw movementsError;
    const paidCents = (movements ?? []).reduce((sum, payment) => {
      if (
        !["completed", "partially_refunded", "refunded"].includes(
          payment.status,
        )
      ) {
        return sum;
      }
      return sum + payment.amount_cents - payment.refunded_cents;
    }, 0);
    const outstandingCents = Math.max(invoice.total_cents - paidCents, 0);
    if (outstandingCents === 0) {
      return errorResponse(
        request,
        "Scadenza già saldata",
        409,
        "already_paid",
      );
    }

    // Un solo checkout attivo per scadenza. Prima di riusarlo viene verificato
    // anche su PayPal, così una riga locale non blocca i pagamenti per sempre.
    const { data: activePayment, error: pendingError } = await admin
      .from("payments")
      .select(
        "id,status,provider_order_id,provider_status,amount_cents,currency,created_at",
      )
      .eq("invoice_id", invoiceId)
      .eq("provider", "paypal")
      .in("status", ["pending", "capturing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pendingError) throw pendingError;
    if (activePayment?.provider_order_id) {
      if (activePayment.status === "capturing") {
        return errorResponse(
          request,
          "Acquisizione PayPal già in corso",
          409,
          "capture_in_progress",
        );
      }

      if (activePayment.amount_cents !== outstandingCents) {
        const { data: cancelled, error: cancelError } = await admin
          .from("payments")
          .update({
            status: "cancelled",
            provider_status: "AMOUNT_CHANGED",
          })
          .eq("id", activePayment.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        if (cancelError) throw cancelError;
        if (!cancelled) {
          return errorResponse(
            request,
            "Lo stato del checkout è cambiato; riprova",
            409,
            "checkout_state_changed",
          );
        }
      } else {
        let remoteOrder: PayPalOrder | null = null;
        try {
          remoteOrder = await paypalRequest<PayPalOrder>(
            `/v2/checkout/orders/${
              encodeURIComponent(activePayment.provider_order_id)
            }`,
            { method: "GET" },
          );
        } catch (error) {
          if (!(error instanceof PayPalApiError) || error.status !== 404) {
            throw error;
          }
        }

        const unit = remoteOrder?.purchase_units?.[0];
        if (remoteOrder) {
          const remoteAmount = unit?.amount?.value
            ? paypalValueToCents(unit.amount.value)
            : null;
          if (
            remoteOrder.id !== activePayment.provider_order_id ||
            unit?.custom_id !== invoice.id ||
            remoteAmount !== activePayment.amount_cents ||
            unit?.amount?.currency_code?.toUpperCase() !==
              activePayment.currency
          ) {
            throw new Error("Ordine PayPal remoto non coerente");
          }

          if (remoteOrder.status === "COMPLETED") {
            const capture = firstCapture(remoteOrder);
            if (!capture) {
              throw new Error("Cattura PayPal completata non trovata");
            }
            const { error: reconcileError } = await admin.rpc(
              "record_paypal_capture",
              {
                p_order_id: remoteOrder.id,
                p_capture_id: capture.id,
                p_capture_status: capture.status,
                p_amount_cents: paypalValueToCents(capture.amount.value),
                p_currency: capture.amount.currency_code,
                p_payload: remoteOrder,
              },
            );
            if (reconcileError) throw reconcileError;
            return errorResponse(
              request,
              capture.status === "COMPLETED"
                ? "Scadenza già saldata"
                : "Pagamento PayPal in elaborazione",
              409,
              capture.status === "COMPLETED"
                ? "already_paid"
                : "payment_processing",
            );
          }

          if (
            REUSABLE_ORDER_STATUSES.has(remoteOrder.status) &&
            orderIsFresh(activePayment.created_at)
          ) {
            return jsonResponse(request, {
              order_id: activePayment.provider_order_id,
              status: remoteOrder.status,
              approval_url: approvalUrl(remoteOrder),
              amount: centsToPayPalValue(activePayment.amount_cents),
              currency: activePayment.currency,
              reused: true,
            });
          }
        }

        const { data: cancelled, error: cancelError } = await admin
          .from("payments")
          .update({
            status: "cancelled",
            provider_status: remoteOrder?.status ?? "EXPIRED_OR_NOT_FOUND",
          })
          .eq("id", activePayment.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        if (cancelError) throw cancelError;
        if (!cancelled) {
          return errorResponse(
            request,
            "Lo stato del checkout è cambiato; riprova",
            409,
            "checkout_state_changed",
          );
        }
      }
    }

    const rawKey = clientRequestId || crypto.randomUUID();
    const idempotencyKey = `create:${user.id}:${invoiceId}:${rawKey}`;
    const { data: idempotentPayment, error: idempotentError } = await admin
      .from("payments")
      .select("provider_order_id,provider_status,amount_cents,currency,status")
      .eq("provider", "paypal")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (idempotentError) throw idempotentError;
    if (idempotentPayment?.provider_order_id) {
      if (idempotentPayment.status === "completed") {
        return errorResponse(
          request,
          "Scadenza già saldata",
          409,
          "already_paid",
        );
      }
      if (idempotentPayment.status !== "pending") {
        return errorResponse(
          request,
          "Questa chiave di richiesta è già stata utilizzata",
          409,
          "idempotency_key_consumed",
        );
      }
      return jsonResponse(request, {
        order_id: idempotentPayment.provider_order_id,
        status: idempotentPayment.provider_status,
        amount: centsToPayPalValue(idempotentPayment.amount_cents),
        currency: idempotentPayment.currency,
        reused: true,
      });
    }

    const order = await paypalRequest<PayPalOrder>("/v2/checkout/orders", {
      method: "POST",
      headers: {
        "PayPal-Request-Id": idempotencyKey.slice(0, 108),
        "Prefer": "return=representation",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          custom_id: invoice.id,
          invoice_id: `${invoice.number.slice(0, 110)}-${rawKey.slice(-12)}`
            .slice(0, 127),
          description: `${invoice.title} · ${invoice.number}`.slice(0, 127),
          amount: {
            currency_code: invoice.currency,
            value: centsToPayPalValue(outstandingCents),
          },
        }],
      }),
    });
    if (!order.id) throw new Error("Risposta ordine PayPal non valida");

    const { error: insertError } = await admin.from("payments").insert({
      invoice_id: invoice.id,
      family_id: invoice.family_id,
      amount_cents: outstandingCents,
      currency: invoice.currency,
      method: "paypal",
      status: "pending",
      provider: "paypal",
      provider_order_id: order.id,
      provider_status: order.status,
      idempotency_key: idempotencyKey,
      created_by: user.id,
      metadata: { initiated_by: user.id },
    });

    if (insertError) {
      // Una richiesta concorrente può avere vinto l'indice pending univoco.
      if (insertError.code === "23505") {
        const { data: winner } = await admin
          .from("payments")
          .select(
            "provider_order_id,provider_status,amount_cents,currency,status",
          )
          .eq("invoice_id", invoiceId)
          .eq("provider", "paypal")
          .in("status", ["pending", "capturing"])
          .maybeSingle();
        if (winner?.provider_order_id) {
          if (winner.status === "capturing") {
            return errorResponse(
              request,
              "Acquisizione PayPal già in corso",
              409,
              "capture_in_progress",
            );
          }
          return jsonResponse(request, {
            order_id: winner.provider_order_id,
            status: winner.provider_status,
            amount: centsToPayPalValue(winner.amount_cents),
            currency: winner.currency,
            reused: true,
          });
        }
      }
      throw insertError;
    }

    return jsonResponse(request, {
      order_id: order.id,
      status: order.status,
      approval_url: approvalUrl(order),
      amount: centsToPayPalValue(outstandingCents),
      currency: invoice.currency,
      reused: false,
    }, 201);
  } catch (error) {
    const message = publicError(error);
    if (message === "auth_missing" || message === "auth_invalid") {
      return errorResponse(request, "Sessione non valida", 401, "unauthorized");
    }
    console.error("paypal-create-order:", message);
    return errorResponse(request, "Impossibile creare l'ordine PayPal", 502);
  }
});
