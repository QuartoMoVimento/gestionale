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
  userIsAdmin,
} from "../_shared/supabase.ts";
import type {
  SupabaseClient,
  User,
} from "npm:@supabase/supabase-js@2.49.8";

interface InviteRequest {
  family_id: string;
  email: string;
  display_name?: string;
  guardian_name?: string;
  phone?: string;
  relationship?: string;
  is_primary?: boolean;
  redirect_to?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuthErrorDetails {
  code: string;
  message: string;
  status: number;
}

interface PublicInviteFailure {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
  action_required?: string;
}

class AuthOperationError extends Error {
  readonly providerError: unknown;

  constructor(error: unknown) {
    super("auth_operation_failed");
    this.name = "AuthOperationError";
    this.providerError = error;
  }
}

function authErrorDetails(error: unknown): AuthErrorDetails {
  const value = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  return {
    code: typeof value.code === "string" ? value.code.toLowerCase() : "",
    message: typeof value.message === "string" ? value.message : "",
    status: typeof value.status === "number" ? value.status : 0,
  };
}

function isEmailConflict(error: unknown): boolean {
  const { code, message } = authErrorDetails(error);
  return ["email_exists", "user_already_exists"].includes(code) ||
    /already (?:been )?(?:registered|exists)|email.*(?:exists|registered)/i
      .test(message);
}

function isEmailDeliveryFailure(error: unknown): boolean {
  const { code, message, status } = authErrorDetails(error);
  return status === 429 ||
    [
      "email_address_not_authorized",
      "email_provider_disabled",
      "over_email_send_rate_limit",
      "over_request_rate_limit",
    ].includes(code) ||
    /email address not authorized|rate limit|smtp|mailer|send(?:ing)? (?:the )?(?:invite )?email/i
      .test(message);
}

function publicInviteFailure(error: unknown): PublicInviteFailure {
  const { code, message, status } = authErrorDetails(error);
  if (
    code === "email_address_not_authorized" ||
    /email address not authorized/i.test(message)
  ) {
    return {
      code: "email_provider_not_configured",
      message:
        "L'invio e-mail non è ancora configurato. Configura un provider SMTP in Supabase Auth e riprova.",
      status: 503,
      retryable: false,
      action_required: "configure_smtp",
    };
  }
  if (
    status === 429 ||
    ["over_email_send_rate_limit", "over_request_rate_limit"].includes(code) ||
    /rate limit/i.test(message)
  ) {
    return {
      code: "email_rate_limit",
      message:
        "Sono stati inviati troppi inviti in poco tempo. Attendi qualche minuto e riprova.",
      status: 429,
      retryable: true,
    };
  }
  if (
    code === "email_address_invalid" ||
    /invalid email|email address.*invalid/i.test(message)
  ) {
    return {
      code: "invalid_email",
      message: "L'indirizzo e-mail non è accettato dal servizio di invio.",
      status: 400,
      retryable: false,
    };
  }
  if (isEmailConflict(error)) {
    return {
      code: "auth_user_conflict",
      message:
        "Esiste già un account con questa e-mail, ma non è stato possibile collegarlo automaticamente.",
      status: 409,
      retryable: false,
    };
  }
  if (isEmailDeliveryFailure(error)) {
    return {
      code: "email_delivery_failed",
      message:
        "Il servizio e-mail non ha accettato l'invito. Verifica la configurazione SMTP e riprova.",
      status: 502,
      retryable: true,
      action_required: "check_smtp",
    };
  }
  return {
    code: "invite_failed",
    message: "Impossibile creare o inviare l'invito.",
    status: status >= 400 && status < 500 ? status : 500,
    retryable: status === 0 || status >= 500,
  };
}

async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<User | null> {
  // L'Admin API non espone una ricerca per e-mail: la scansione è usata solo
  // per recuperare un conflitto raro (utente Auth esistente senza profilo).
  const perPage = 200;
  const maxPages = 25;
  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new AuthOperationError(error);
    const match = data.users.find((candidate) =>
      String(candidate.email ?? "").trim().toLowerCase() === email
    );
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  return null;
}

async function ensureProfile(
  admin: SupabaseClient,
  authUser: User,
  email: string,
  displayName: string,
): Promise<{ profileCreated: boolean; isActive: boolean }> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,is_active")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile) {
    return { profileCreated: false, isActive: profile.is_active === true };
  }

  const { error: insertError } = await admin.from("profiles").insert({
    id: authUser.id,
    email,
    display_name: displayName || email.split("@")[0] || "Famiglia",
    role: "family",
    is_active: true,
  });
  if (!insertError) return { profileCreated: true, isActive: true };

  // Una richiesta concorrente può avere appena riparato lo stesso profilo.
  if (insertError.code === "23505") {
    const { data: concurrentProfile, error: concurrentError } = await admin
      .from("profiles")
      .select("is_active")
      .eq("id", authUser.id)
      .maybeSingle();
    if (concurrentError) throw concurrentError;
    if (concurrentProfile) {
      return {
        profileCreated: false,
        isActive: concurrentProfile.is_active === true,
      };
    }
  }
  throw insertError;
}

function authUserIsConfirmed(user: User): boolean {
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

function allowedRedirect(value?: string): string | undefined {
  const siteUrl = (
    Deno.env.get("SITE_URL") ??
      "https://gestionale.quartomovimento.it"
  ).replace(/\/$/, "");
  const fallback = Deno.env.get("INVITE_REDIRECT_URL") ??
    (siteUrl ? `${siteUrl}/?auth_action=set-password` : undefined);
  const candidate = value || fallback;
  if (!candidate) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("redirect_invalid");
  }

  const configured = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const fallbackOrigins = [
    "https://gestionale.quartomovimento.it",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
  const allowed = new Set(configured.length ? configured : fallbackOrigins);
  if (!allowed.has(parsed.origin)) throw new Error("redirect_invalid");
  return parsed.toString();
}

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const methodError = requirePost(request);
  if (methodError) return methodError;

  try {
    const { user } = await authenticatedUser(request);
    const admin = serviceClient();
    if (!await userIsAdmin(admin, user.id)) {
      return errorResponse(
        request,
        "Operazione riservata all'amministratore",
        403,
        "admin_required",
      );
    }

    let body: InviteRequest;
    try {
      body = await readJson<InviteRequest>(request);
    } catch {
      return errorResponse(request, "JSON non valido", 400, "invalid_json");
    }

    const familyId = String(body.family_id ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const displayName = String(
      body.display_name ?? body.guardian_name ?? "",
    ).trim();
    if (!UUID_PATTERN.test(familyId)) {
      return errorResponse(
        request,
        "Famiglia non valida",
        400,
        "invalid_family",
      );
    }
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return errorResponse(request, "Email non valida", 400, "invalid_email");
    }

    const { data: family, error: familyError } = await admin
      .from("families")
      .select("id,display_name,is_active")
      .eq("id", familyId)
      .maybeSingle();
    if (familyError) throw familyError;
    if (!family?.is_active) {
      return errorResponse(request, "Famiglia non trovata o inattiva", 404);
    }

    // Il profilo è normalmente sincronizzato con Auth dal trigger. Il recupero
    // qui sotto gestisce anche utenti Auth preesistenti/orfani e reinviti.
    const { data: existingProfile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,is_active")
      .ilike("email", email)
      .maybeSingle();
    if (profileError) throw profileError;

    if (existingProfile && !existingProfile.is_active) {
      return errorResponse(
        request,
        "Utente disattivato",
        409,
        "user_inactive",
      );
    }

    const redirectTo = allowedRedirect(body.redirect_to);
    const inviteOptions = {
      ...(redirectTo ? { redirectTo } : {}),
      data: {
        display_name: displayName || family.display_name,
        invited_for_family_id: familyId,
      },
    };

    let authUser: User | null = null;
    let linkedExistingUser = Boolean(existingProfile);
    let invitationSent = false;
    let manualInviteUrl: string | null = null;

    if (existingProfile) {
      const { data, error } = await admin.auth.admin.getUserById(
        existingProfile.id,
      );
      if (error || !data.user) {
        throw new AuthOperationError(
          error ?? new Error("Utente Auth non trovato"),
        );
      }
      authUser = data.user;
    }

    // Un utente già confermato va soltanto collegato. Un utente non ancora
    // confermato viene invece reinvitato: la chiamata è quindi idempotente e
    // permette di recuperare un precedente invito scaduto o non consegnato.
    if (!authUser || !authUserIsConfirmed(authUser)) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        ...inviteOptions,
      });

      if (!error && data.user) {
        authUser = data.user;
        invitationSent = true;
      } else {
        const inviteError = error ?? new Error("Invito non creato");
        if (isEmailConflict(inviteError)) {
          // Caso raro: l'utente Auth è confermato ma il trigger non ha creato
          // (o qualcuno ha rimosso) il profilo applicativo.
          authUser = authUser ?? await findAuthUserByEmail(admin, email);
          if (!authUser) throw new AuthOperationError(inviteError);
          linkedExistingUser = true;
          if (!authUserIsConfirmed(authUser)) {
            // Alcune versioni/configurazioni Auth possono rispondere con un
            // conflitto anche per un account invitato ma non confermato. In
            // quel caso il retry deve comunque produrre un accesso utilizzabile.
            const { data: linkData, error: linkError } = await admin.auth.admin
              .generateLink({
                type: "invite",
                email,
                options: inviteOptions,
              });
            const actionLink = linkData?.properties?.action_link;
            if (!linkError && linkData?.user && actionLink) {
              authUser = linkData.user;
              manualInviteUrl = actionLink;
            } else {
              throw new AuthOperationError(linkError ?? inviteError);
            }
          }
        } else if (isEmailDeliveryFailure(inviteError)) {
          // generateLink non invia e-mail. Il link è una credenziale monouso:
          // viene restituito esclusivamente dopo la verifica JWT+ruolo admin,
          // con Cache-Control no-store, e non deve mai essere loggato/salvato.
          const { data: linkData, error: linkError } = await admin.auth.admin
            .generateLink({
              type: "invite",
              email,
              options: inviteOptions,
            });
          const actionLink = linkData?.properties?.action_link;
          if (!linkError && linkData?.user && actionLink) {
            authUser = linkData.user;
            manualInviteUrl = actionLink;
          } else {
            const fallbackDetails = authErrorDetails(linkError);
            console.error(
              "invite-family manual-link:",
              JSON.stringify({
                provider_code: fallbackDetails.code || "unknown",
                provider_status: fallbackDetails.status || 0,
              }),
            );
            throw new AuthOperationError(inviteError);
          }
        } else {
          throw new AuthOperationError(inviteError);
        }
      }
    }

    if (!authUser) {
      throw new AuthOperationError(new Error("Utente Auth non disponibile"));
    }

    const profileState = await ensureProfile(
      admin,
      authUser,
      email,
      displayName || family.display_name,
    );
    if (!profileState.isActive) {
      return errorResponse(
        request,
        "Utente disattivato",
        409,
        "user_inactive",
      );
    }
    const invitedUserId = authUser.id;

    const { error: updateError } = await admin
      .from("profiles")
      .update({
        ...(displayName ? { display_name: displayName } : {}),
        ...(body.phone ? { phone: String(body.phone).trim() } : {}),
      })
      .eq("id", invitedUserId);
    if (updateError) throw updateError;

    const { error: linkError } = await admin
      .from("family_users")
      .upsert(
        {
          family_id: familyId,
          user_id: invitedUserId,
          relationship: body.relationship
            ? String(body.relationship).trim()
            : null,
          is_primary: Boolean(body.is_primary),
        },
        { onConflict: "family_id,user_id" },
      );
    if (linkError) throw linkError;

    return jsonResponse(request, {
      ok: true,
      user_id: invitedUserId,
      family_id: familyId,
      invitation_sent: invitationSent,
      invitation_delivery: invitationSent
        ? "email"
        : manualInviteUrl
        ? "manual_link"
        : "not_required",
      manual_invite_created: Boolean(manualInviteUrl),
      ...(manualInviteUrl ? { manual_invite_url: manualInviteUrl } : {}),
      linked_existing_user: linkedExistingUser,
      profile_repaired: profileState.profileCreated,
    });
  } catch (error) {
    const message = publicError(error);
    if (message === "auth_missing" || message === "auth_invalid") {
      return errorResponse(request, "Sessione non valida", 401, "unauthorized");
    }
    if (message === "redirect_invalid") {
      return errorResponse(
        request,
        "URL di reindirizzamento non autorizzato",
        400,
        "invalid_redirect",
      );
    }
    if (error instanceof AuthOperationError) {
      const failure = publicInviteFailure(error.providerError);
      const provider = authErrorDetails(error.providerError);
      console.error(
        "invite-family auth:",
        JSON.stringify({
          code: failure.code,
          provider_code: provider.code || "unknown",
          provider_status: provider.status || 0,
        }),
      );
      return jsonResponse(
        request,
        {
          ok: false,
          error: failure.message,
          code: failure.code,
          retryable: failure.retryable,
          ...(failure.action_required
            ? { action_required: failure.action_required }
            : {}),
        },
        failure.status,
      );
    }
    console.error("invite-family:", message);
    return errorResponse(request, "Impossibile inviare l'invito", 500);
  }
});
