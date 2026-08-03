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

    // Il profilo è sincronizzato con Auth dal trigger della migrazione.
    const { data: existingProfile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,is_active")
      .ilike("email", email)
      .maybeSingle();
    if (profileError) throw profileError;

    let invitedUserId: string;
    let invitationSent = false;
    if (existingProfile) {
      if (!existingProfile.is_active) {
        return errorResponse(
          request,
          "Utente disattivato",
          409,
          "user_inactive",
        );
      }
      invitedUserId = existingProfile.id;
    } else {
      const redirectTo = allowedRedirect(body.redirect_to);
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        ...(redirectTo ? { redirectTo } : {}),
        data: {
          display_name: displayName || family.display_name,
          invited_for_family_id: familyId,
        },
      });
      if (error || !data.user) {
        throw error ?? new Error("Invito non creato");
      }
      invitedUserId = data.user.id;
      invitationSent = true;
    }

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
      linked_existing_user: !invitationSent,
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
    console.error("invite-family:", message);
    return errorResponse(request, "Impossibile inviare l'invito", 500);
  }
});
