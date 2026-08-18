import {
  errorResponse,
  handlePreflight,
  jsonResponse,
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

type InviteAction = "status" | "generate_link";
type AccountStatus =
  | "missing"
  | "pending"
  | "active"
  | "disabled"
  | "role_invalid";

interface InviteRequest {
  action?: unknown;
  family_id?: unknown;
  target_emails?: unknown;
  target_email?: unknown;
  redirect_to?: unknown;
}

interface FamilyRecord {
  id: string;
  display_name: string;
  guardian_name: string;
  email: string;
  is_active: boolean;
}

interface ProfileRecord {
  id: string;
  email: string | null;
  is_active: boolean;
  role: string;
}

interface AccountResolution {
  email: string;
  profile: ProfileRecord | null;
  user: User | null;
}

interface PublicAccountStatus {
  email: string;
  account_status: AccountStatus;
  account_active: boolean;
  code?: string;
  message?: string;
}

interface AuthErrorDetails {
  code: string;
  message: string;
  status: number;
}

interface PublicAuthFailure {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STATUS_EMAILS = 50;

class PublicOperationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    status = 400,
    retryable = false,
  ) {
    super(message);
    this.name = "PublicOperationError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

class AuthOperationError extends Error {
  readonly providerError: unknown;
  readonly operation: InviteAction;

  constructor(error: unknown, operation: InviteAction) {
    super("auth_operation_failed");
    this.name = "AuthOperationError";
    this.providerError = error;
    this.operation = operation;
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

function isUserNotFound(error: unknown): boolean {
  const { code, message, status } = authErrorDetails(error);
  return code === "user_not_found" ||
    status === 404 ||
    /user.*not found/i.test(message);
}

function publicAuthFailure(
  error: unknown,
  operation: InviteAction,
): PublicAuthFailure {
  const { code, message, status } = authErrorDetails(error);

  if (
    code === "email_address_invalid" ||
    /invalid email|email address.*invalid/i.test(message)
  ) {
    return {
      code: "invalid_email",
      message: "L'indirizzo e-mail non è accettato da Supabase.",
      status: 400,
      retryable: false,
    };
  }

  if (isEmailConflict(error)) {
    return {
      code: "auth_user_conflict",
      message:
        "Esiste già un account con questa e-mail, ma non è stato possibile verificarlo o collegarlo.",
      status: 409,
      retryable: false,
    };
  }

  if (
    status === 429 ||
    ["over_request_rate_limit", "rate_limit_exceeded"].includes(code) ||
    /rate limit/i.test(message)
  ) {
    return {
      code: operation === "status"
        ? "account_status_rate_limited"
        : "link_generation_rate_limited",
      message:
        "Supabase ha limitato temporaneamente le richieste. Attendi qualche minuto e riprova.",
      status: 429,
      retryable: true,
    };
  }

  if (status === 401 || status === 403 || code === "not_admin") {
    return {
      code: "auth_admin_unavailable",
      message:
        "Il servizio amministrativo di Supabase non è disponibile. Verifica la configurazione della Edge Function.",
      status: 503,
      retryable: false,
    };
  }

  return operation === "status"
    ? {
      code: "account_status_failed",
      message: "Non è stato possibile verificare lo stato dell'account.",
      status: 502,
      retryable: true,
    }
    : {
      code: "link_generation_failed",
      message: "Supabase non ha generato il link di invito.",
      status: 502,
      retryable: true,
    };
}

function failureResponse(
  request: Request,
  failure: {
    code: string;
    message: string;
    status: number;
    retryable: boolean;
  },
): Response {
  return jsonResponse(
    request,
    {
      ok: false,
      error: failure.message,
      code: failure.code,
      retryable: failure.retryable,
    },
    failure.status,
  );
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validatedEmail(value: unknown): string {
  const email = normalizeEmail(value);
  if (!email || email.endsWith("@invalid.local")) {
    throw new PublicOperationError(
      "family_email_missing",
      "La famiglia non ha un indirizzo e-mail utilizzabile.",
      400,
    );
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new PublicOperationError(
      "invalid_email",
      "L'indirizzo e-mail non è valido.",
      400,
    );
  }
  return email;
}

function authUserIsConfirmed(user: User): boolean {
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

function authUserIsDisabled(user: User): boolean {
  const value = user as unknown as Record<string, unknown>;
  if (value.deleted_at) return true;
  if (typeof value.banned_until !== "string" || !value.banned_until) {
    return false;
  }
  const bannedUntil = new Date(value.banned_until);
  return !Number.isNaN(bannedUntil.getTime()) &&
    bannedUntil.getTime() > Date.now();
}

function relationRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isMissingRelationError(error: unknown): boolean {
  const value = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  const code = typeof value.code === "string" ? value.code : "";
  const message = typeof value.message === "string" ? value.message : "";
  return ["42P01", "PGRST205"].includes(code) ||
    /family_access_emails.*(does not exist|schema cache|non esiste)/i
      .test(message);
}

function allowedRedirect(value?: unknown): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new PublicOperationError(
      "invalid_redirect",
      "URL di reindirizzamento non autorizzato.",
      400,
    );
  }

  const siteUrl = (
    Deno.env.get("SITE_URL") ??
      "https://gestionale.quartomovimento.it"
  ).replace(/\/$/, "");
  const fallback = Deno.env.get("INVITE_REDIRECT_URL") ??
    (siteUrl ? siteUrl + "/?auth_action=set-password" : undefined);
  const candidate = value || fallback;
  if (!candidate) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new PublicOperationError(
      "invalid_redirect",
      "URL di reindirizzamento non autorizzato.",
      400,
    );
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
  if (!allowed.has(parsed.origin)) {
    throw new PublicOperationError(
      "invalid_redirect",
      "URL di reindirizzamento non autorizzato.",
      400,
    );
  }
  return parsed.toString();
}

async function loadFamily(
  admin: SupabaseClient,
  familyId: string,
): Promise<FamilyRecord> {
  const { data, error } = await admin
    .from("families")
    .select("id,display_name,guardian_name,email,is_active")
    .eq("id", familyId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.is_active) {
    throw new PublicOperationError(
      "family_not_found",
      "Famiglia non trovata o inattiva.",
      404,
    );
  }
  return data as FamilyRecord;
}

async function allowedEmailsForFamily(
  admin: SupabaseClient,
  family: FamilyRecord,
): Promise<Set<string>> {
  const allowed = new Set<string>();
  const primaryEmail = normalizeEmail(family.email);
  if (
    primaryEmail &&
    EMAIL_PATTERN.test(primaryEmail) &&
    !primaryEmail.endsWith("@invalid.local")
  ) {
    allowed.add(primaryEmail);
  }

  const accessResult = await admin
    .from("family_access_emails")
    .select("email")
    .eq("family_id", family.id);
  if (accessResult.error && !isMissingRelationError(accessResult.error)) {
    throw accessResult.error;
  }
  for (const row of accessResult.data ?? []) {
    const email = normalizeEmail(row.email);
    if (email) allowed.add(email);
  }

  const linksResult = await admin
    .from("family_users")
    .select(
      "profile:profiles!family_users_user_id_fkey(email)",
    )
    .eq("family_id", family.id);
  if (linksResult.error) throw linksResult.error;
  for (const row of linksResult.data ?? []) {
    const profile = relationRecord<{ email?: unknown }>(row.profile);
    const email = normalizeEmail(profile?.email);
    if (email) allowed.add(email);
  }

  return allowed;
}

async function assertEmailsBelongToFamily(
  admin: SupabaseClient,
  family: FamilyRecord,
  emails: string[],
): Promise<void> {
  const allowed = await allowedEmailsForFamily(admin, family);
  const rejected = emails.filter((email) => !allowed.has(email));
  if (!rejected.length) return;

  throw new PublicOperationError(
    "email_not_in_family",
    rejected.length === 1
      ? "L'indirizzo e-mail non appartiene a questa famiglia."
      : "Uno o più indirizzi e-mail non appartengono a questa famiglia.",
    403,
  );
}

async function findProfileByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<ProfileRecord | null> {
  const { data, error } = await admin
    .from("profiles")
    .select("id,email,is_active,role")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  return data ? data as ProfileRecord : null;
}

async function findAuthUsersByEmails(
  admin: SupabaseClient,
  emails: string[],
  operation: InviteAction,
): Promise<Map<string, User>> {
  const wanted = new Set(emails);
  const matches = new Map<string, User>();
  if (!wanted.size) return matches;

  const perPage = 200;
  const maxPages = 100;
  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new AuthOperationError(error, operation);

    for (const candidate of data.users) {
      const candidateEmail = normalizeEmail(candidate.email);
      if (wanted.has(candidateEmail)) {
        matches.set(candidateEmail, candidate);
      }
    }

    if (matches.size === wanted.size || data.users.length < perPage) break;
  }
  return matches;
}

async function resolveAccounts(
  admin: SupabaseClient,
  emails: string[],
  operation: InviteAction,
): Promise<AccountResolution[]> {
  const resolutions: AccountResolution[] = [];
  const needsDirectoryLookup: string[] = [];

  for (const email of emails) {
    const profile = await findProfileByEmail(admin, email);
    let authUser: User | null = null;

    if (profile?.is_active !== false && profile?.role === "family") {
      const { data, error } = await admin.auth.admin.getUserById(profile.id);
      if (error && !isUserNotFound(error)) {
        throw new AuthOperationError(error, operation);
      }
      authUser = data?.user ?? null;
    }

    if (!authUser && !profile) needsDirectoryLookup.push(email);
    resolutions.push({ email, profile, user: authUser });
  }

  const directoryUsers = await findAuthUsersByEmails(
    admin,
    needsDirectoryLookup,
    operation,
  );
  for (const resolution of resolutions) {
    if (!resolution.user && !resolution.profile) {
      resolution.user = directoryUsers.get(resolution.email) ?? null;
    }
    if (
      resolution.user &&
      normalizeEmail(resolution.user.email) !== resolution.email
    ) {
      throw new PublicOperationError(
        "auth_user_conflict",
        "L'account Supabase non corrisponde all'indirizzo richiesto.",
        409,
      );
    }
  }

  return resolutions;
}

function publicAccountStatus(
  resolution: AccountResolution,
): PublicAccountStatus {
  if (
    resolution.profile?.is_active === false ||
    (resolution.user && authUserIsDisabled(resolution.user))
  ) {
    return {
      email: resolution.email,
      account_status: "disabled",
      account_active: false,
      code: "user_inactive",
      message: "Account disattivato.",
    };
  }

  if (resolution.profile && resolution.profile.role !== "family") {
    return {
      email: resolution.email,
      account_status: "role_invalid",
      account_active: false,
      code: "user_role_invalid",
      message: "L'indirizzo appartiene a un account amministrativo.",
    };
  }

  if (!resolution.user) {
    return {
      email: resolution.email,
      account_status: "missing",
      account_active: false,
    };
  }

  if (authUserIsConfirmed(resolution.user)) {
    return {
      email: resolution.email,
      account_status: "active",
      account_active: true,
    };
  }

  return {
    email: resolution.email,
    account_status: "pending",
    account_active: false,
  };
}

async function ensureProfile(
  admin: SupabaseClient,
  authUser: User,
  email: string,
  displayName: string,
): Promise<{ profileCreated: boolean }> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,email,is_active,role")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileError) throw profileError;

  if (profile) {
    if (profile.is_active !== true) {
      throw new PublicOperationError(
        "user_inactive",
        "L'account è disattivato.",
        409,
      );
    }
    if (profile.role !== "family") {
      throw new PublicOperationError(
        "user_role_invalid",
        "Questo indirizzo appartiene a un account amministrativo.",
        409,
      );
    }
    return { profileCreated: false };
  }

  const { error: insertError } = await admin.from("profiles").insert({
    id: authUser.id,
    email,
    display_name: displayName || email.split("@")[0] || "Famiglia",
    role: "family",
    is_active: true,
  });
  if (!insertError) return { profileCreated: true };

  if (insertError.code === "23505") {
    const concurrentProfile = await findProfileByEmail(admin, email);
    if (concurrentProfile?.id === authUser.id) {
      if (!concurrentProfile.is_active) {
        throw new PublicOperationError(
          "user_inactive",
          "L'account è disattivato.",
          409,
        );
      }
      if (concurrentProfile.role !== "family") {
        throw new PublicOperationError(
          "user_role_invalid",
          "Questo indirizzo appartiene a un account amministrativo.",
          409,
        );
      }
      return { profileCreated: false };
    }
    throw new PublicOperationError(
      "auth_user_conflict",
      "Esiste già un profilo diverso con questa e-mail.",
      409,
    );
  }
  throw insertError;
}

async function ensureFamilyLink(
  admin: SupabaseClient,
  familyId: string,
  userId: string,
): Promise<{ linkCreated: boolean }> {
  const { data: existing, error: existingError } = await admin
    .from("family_users")
    .select("family_id,user_id")
    .eq("family_id", familyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { linkCreated: false };

  const { error: insertError } = await admin.from("family_users").insert({
    family_id: familyId,
    user_id: userId,
  });
  if (!insertError) return { linkCreated: true };

  if (insertError.code === "23505") {
    const { data: concurrent, error: concurrentError } = await admin
      .from("family_users")
      .select("family_id,user_id")
      .eq("family_id", familyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (concurrentError) throw concurrentError;
    if (concurrent) return { linkCreated: false };
  }
  throw insertError;
}

function validActionLink(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 16384) return null;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}

function validateRequestFields(
  body: Record<string, unknown>,
  action: InviteAction,
): void {
  if (Object.prototype.hasOwnProperty.call(body, "email")) {
    throw new PublicOperationError(
      "legacy_email_not_allowed",
      "Il campo email non è più accettato.",
      400,
    );
  }

  const allowed = action === "status"
    ? new Set(["action", "family_id", "target_emails"])
    : new Set(["action", "family_id", "target_email", "redirect_to"]);
  const unsupported = Object.keys(body).find((key) => !allowed.has(key));
  if (unsupported) {
    throw new PublicOperationError(
      "invalid_request",
      "La richiesta contiene campi non supportati.",
      400,
    );
  }
}

function statusEmails(body: InviteRequest): string[] {
  if (!Array.isArray(body.target_emails)) {
    throw new PublicOperationError(
      "invalid_target_emails",
      "target_emails deve essere un elenco di indirizzi.",
      400,
    );
  }
  if (!body.target_emails.length) {
    throw new PublicOperationError(
      "family_email_missing",
      "La famiglia non ha indirizzi e-mail da verificare.",
      400,
    );
  }
  if (body.target_emails.length > MAX_STATUS_EMAILS) {
    throw new PublicOperationError(
      "too_many_target_emails",
      "Sono stati richiesti troppi indirizzi contemporaneamente.",
      400,
    );
  }

  return Array.from(
    new Set(body.target_emails.map((value) => validatedEmail(value))),
  );
}

async function activeGenerateResponse(
  request: Request,
  admin: SupabaseClient,
  family: FamilyRecord,
  email: string,
  authUser: User,
  linkedExistingUser: boolean,
): Promise<Response> {
  const profileState = await ensureProfile(
    admin,
    authUser,
    email,
    family.guardian_name || family.display_name,
  );
  const linkState = await ensureFamilyLink(admin, family.id, authUser.id);
  return jsonResponse(request, {
    ok: true,
    action: "generate_link",
    family_id: family.id,
    target_email: email,
    account_status: "active",
    account_active: true,
    link_generated: false,
    linked_existing_user: linkedExistingUser,
    profile_repaired: profileState.profileCreated,
    family_link_created: linkState.linkCreated,
  });
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
        "Operazione riservata all'amministratore.",
        403,
        "admin_required",
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await readJson<unknown>(request);
    } catch {
      throw new PublicOperationError(
        "invalid_json",
        "JSON non valido.",
        400,
      );
    }
    if (
      !rawBody ||
      typeof rawBody !== "object" ||
      Array.isArray(rawBody)
    ) {
      throw new PublicOperationError(
        "invalid_request",
        "La richiesta deve essere un oggetto JSON.",
        400,
      );
    }

    const body = rawBody as Record<string, unknown> & InviteRequest;
    const action = body.action;
    if (action !== "status" && action !== "generate_link") {
      throw new PublicOperationError(
        "invalid_action",
        "Azione non supportata.",
        400,
      );
    }
    validateRequestFields(body, action);

    const familyId = typeof body.family_id === "string"
      ? body.family_id.trim()
      : "";
    if (!UUID_PATTERN.test(familyId)) {
      throw new PublicOperationError(
        "invalid_family",
        "Famiglia non valida.",
        400,
      );
    }
    const family = await loadFamily(admin, familyId);

    if (action === "status") {
      const emails = statusEmails(body);
      await assertEmailsBelongToFamily(admin, family, emails);
      const resolutions = await resolveAccounts(admin, emails, action);
      return jsonResponse(request, {
        ok: true,
        action,
        family_id: family.id,
        accounts: resolutions.map(publicAccountStatus),
      });
    }

    const email = validatedEmail(body.target_email);
    await assertEmailsBelongToFamily(admin, family, [email]);
    const [resolution] = await resolveAccounts(admin, [email], action);
    const initialStatus = publicAccountStatus(resolution);

    if (initialStatus.account_status === "disabled") {
      throw new PublicOperationError(
        initialStatus.code || "user_inactive",
        initialStatus.message || "L'account è disattivato.",
        409,
      );
    }
    if (initialStatus.account_status === "role_invalid") {
      throw new PublicOperationError(
        initialStatus.code || "user_role_invalid",
        initialStatus.message ||
          "L'indirizzo appartiene a un account amministrativo.",
        409,
      );
    }
    if (initialStatus.account_status === "active" && resolution.user) {
      return await activeGenerateResponse(
        request,
        admin,
        family,
        email,
        resolution.user,
        true,
      );
    }

    const redirectTo = allowedRedirect(body.redirect_to);
    const options = {
      ...(redirectTo ? { redirectTo } : {}),
      data: {
        display_name: family.guardian_name || family.display_name,
        invited_for_family_id: family.id,
      },
    };
    const { data: linkData, error: linkError } = await admin.auth.admin
      .generateLink({
        type: "invite",
        email,
        options,
      });

    if (linkError) {
      if (isEmailConflict(linkError)) {
        const [freshResolution] = await resolveAccounts(
          admin,
          [email],
          action,
        );
        const freshStatus = publicAccountStatus(freshResolution);
        if (freshStatus.account_status === "active" && freshResolution.user) {
          return await activeGenerateResponse(
            request,
            admin,
            family,
            email,
            freshResolution.user,
            true,
          );
        }
        if (freshStatus.account_status === "disabled") {
          throw new PublicOperationError(
            "user_inactive",
            "L'account è disattivato.",
            409,
          );
        }
        if (freshStatus.account_status === "role_invalid") {
          throw new PublicOperationError(
            "user_role_invalid",
            "L'indirizzo appartiene a un account amministrativo.",
            409,
          );
        }
      }
      throw new AuthOperationError(linkError, action);
    }

    const actionLink = validActionLink(
      linkData?.properties?.action_link,
    );
    const generatedUser = linkData?.user ?? null;
    if (
      !generatedUser ||
      !actionLink ||
      normalizeEmail(generatedUser.email) !== email
    ) {
      throw new PublicOperationError(
        "invalid_link_response",
        "Supabase ha restituito una risposta non valida per il link di invito.",
        502,
        true,
      );
    }

    const profileState = await ensureProfile(
      admin,
      generatedUser,
      email,
      family.guardian_name || family.display_name,
    );
    const linkState = await ensureFamilyLink(
      admin,
      family.id,
      generatedUser.id,
    );

    return jsonResponse(request, {
      ok: true,
      action,
      family_id: family.id,
      target_email: email,
      account_status: "pending",
      account_active: false,
      link_generated: true,
      activation_link: actionLink,
      linked_existing_user: Boolean(resolution.user || resolution.profile),
      profile_repaired: profileState.profileCreated,
      family_link_created: linkState.linkCreated,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "auth_missing" || error.message === "auth_invalid")
    ) {
      return errorResponse(request, "Sessione non valida.", 401, "unauthorized");
    }

    if (error instanceof PublicOperationError) {
      return failureResponse(request, {
        code: error.code,
        message: error.message,
        status: error.status,
        retryable: error.retryable,
      });
    }

    if (error instanceof AuthOperationError) {
      const failure = publicAuthFailure(error.providerError, error.operation);
      const provider = authErrorDetails(error.providerError);
      console.error(
        "invite-family auth:",
        JSON.stringify({
          action: error.operation,
          code: failure.code,
          provider_code: provider.code || "unknown",
          provider_status: provider.status || 0,
        }),
      );
      return failureResponse(request, failure);
    }

    const value = error && typeof error === "object"
      ? error as Record<string, unknown>
      : {};
    console.error(
      "invite-family:",
      JSON.stringify({
        code: typeof value.code === "string" ? value.code : "unknown",
        status: typeof value.status === "number" ? value.status : 0,
      }),
    );
    return failureResponse(request, {
      code: "family_access_failed",
      message: "Non è stato possibile gestire l'accesso della famiglia.",
      status: 500,
      retryable: true,
    });
  }
});
