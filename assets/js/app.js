(function () {
  "use strict";

  const appRoot = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");
  const config = window.QM_CONFIG || {};
  const isSupabaseConfigured = Boolean(
    config.supabaseUrl &&
      /^https:\/\//.test(config.supabaseUrl) &&
      config.supabaseAnonKey &&
      config.supabaseAnonKey.length > 20,
  );

  const ROLE_ADMIN = "admin";
  const ROLE_FAMILY = "family";
  const WHATSAPP_URL =
    "https://api.whatsapp.com/send/?phone=%2B393277749860&text&type=phone_number&app_absent=0";
  const TIDYCAL_URL = "https://tidycal.com/quartomov/chiamata-informativa";
  const PAYPAL_ME_URL =
    "https://paypal.me/quartomov?locale.x=it_IT&country.x=IT";
  const BANK_REFERENCE_TEMPLATE = "{nome}, {cognome}, {numero}";
  const AUTH_EMAIL_COOLDOWN_KEY = "qm_auth_email_cooldown_until";
  const AUTH_EMAIL_COOLDOWN_MS = 60 * 1000;
  const AUTH_EMAIL_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
  const ADMIN_ROUTES = [
    "overview",
    "attendance",
    "students",
    "calendar",
    "courses",
    "makeups",
    "payments",
    "settings",
  ];
  const FAMILY_ROUTES = [
    "home",
    "lessons",
    "attendance",
    "makeups",
    "payments",
  ];

  const state = {
    supabase: null,
    store: null,
    mode: isSupabaseConfigured ? "production" : "demo",
    user: null,
    profile: null,
    role: null,
    data: null,
    loading: true,
    demoBannerVisible: true,
    attendanceDate: todayKey(),
    calendarMonth: startOfMonth(new Date()),
    calendarSelectedDate: todayKey(),
    selectedStudentId: null,
    filters: {
      studentSearch: "",
      studentCourse: "all",
      paymentSearch: "",
      paymentStatus: "all",
    },
    settingsTab: "school",
    authListener: null,
    paymentReminderChannel: null,
    familyAccountStatuses: {},
    authFingerprint: null,
    lastDataRefreshAt: 0,
  };

  const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9.5 20v-6h5v6"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    check:
      '<path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="10"/>',
    checkSimple: '<path d="m5 12 4 4L19 6"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    wallet:
      '<path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6"/><path d="M16 13h4"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34L7 19.8 4.2 17l.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7 7 4.2l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V3h4v.08A1.7 1.7 0 0 0 15.06 4.6a1.7 1.7 0 0 0 1.88-.34L17 4.2 19.8 7l-.06.06A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 21 10h.08v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    repeat:
      '<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    logout:
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search:
      '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    bell:
      '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.2 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 18h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    music:
      '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    receipt:
      '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    eye:
      '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    eyeOff:
      '<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2 2.9M6.6 6.6C3.5 8.5 2 12 2 12s3.5 8 10 8a9 9 0 0 0 4.1-.9"/>',
    edit:
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v5M12 8h.01"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    phone:
      '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7a2 2 0 0 1 1.7 2.1Z"/>',
    map:
      '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    card:
      '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h3"/>',
    bank:
      '<path d="m3 10 9-6 9 6M5 10h14M6 10v7M10 10v7M14 10v7M18 10v7M3 20h18"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"/>',
    download:
      '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    alert:
      '<path d="M10.3 3.2 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    trash:
      '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };

  function icon(name, size) {
    const iconSize = size || 18;
    return `<svg aria-hidden="true" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.info}</svg>`;
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function toLocalDate(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      const [year, month, day] = String(value).split("-").map(Number);
      return new Date(year, month - 1, day, 12, 0, 0, 0);
    }
    return new Date(value);
  }

  function dateKey(value) {
    const date = toLocalDate(value);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function startOfMonth(value) {
    const date = toLocalDate(value);
    return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
  }

  function addDays(value, amount) {
    const date = toLocalDate(value);
    date.setDate(date.getDate() + amount);
    return date;
  }

  function addMonths(value, amount) {
    const date = startOfMonth(value);
    date.setMonth(date.getMonth() + amount);
    return date;
  }

  function formatDate(value, options) {
    if (!value) return "—";
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
    const formatOptions = {
      ...(options || { day: "numeric", month: "short", year: "numeric" }),
      ...(dateOnly ? {} : { timeZone: "Europe/Rome" }),
    };
    return new Intl.DateTimeFormat(
      "it-IT",
      formatOptions,
    ).format(toLocalDate(value));
  }

  function formatLongDate(value) {
    return formatDate(value, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function formatTime(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Rome",
    }).format(new Date(value));
  }

  function romeDateTime(dateValue, timeValue) {
    const dateMatch = String(dateValue || "").match(
      /^(\d{4})-(\d{2})-(\d{2})$/,
    );
    const timeMatch = String(timeValue || "").match(/^(\d{2}):(\d{2})$/);
    if (!dateMatch || !timeMatch) return new Date(NaN);
    const target = {
      year: Number(dateMatch[1]),
      month: Number(dateMatch[2]),
      day: Number(dateMatch[3]),
      hour: Number(timeMatch[1]),
      minute: Number(timeMatch[2]),
    };
    let candidate = new Date(
      Date.UTC(
        target.year,
        target.month - 1,
        target.day,
        target.hour,
        target.minute,
      ),
    );
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(
        formatter
          .formatToParts(candidate)
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)]),
      );
      const represented = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
      );
      const wanted = Date.UTC(
        target.year,
        target.month - 1,
        target.day,
        target.hour,
        target.minute,
      );
      candidate = new Date(candidate.getTime() + wanted - represented);
    }
    const finalParts = Object.fromEntries(
      formatter
        .formatToParts(candidate)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    if (
      finalParts.year !== target.year ||
      finalParts.month !== target.month ||
      finalParts.day !== target.day ||
      finalParts.hour !== target.hour ||
      finalParts.minute !== target.minute
    ) {
      return new Date(NaN);
    }
    return candidate;
  }

  function formatMonth(value) {
    return formatDate(value, { month: "long", year: "numeric" });
  }

  function formatMoney(cents, currency) {
    return new Intl.NumberFormat("it-IT", {
      style: "currency",
      currency: currency || "EUR",
    }).format((Number(cents) || 0) / 100);
  }

  function fullName(student) {
    if (!student) return "Allievo";
    return [student.first_name, student.last_name].filter(Boolean).join(" ");
  }

  function initials(value) {
    return String(value || "QM")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  function normalizeEmailList(value) {
    const source = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
    return [...new Set(source
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(Boolean))];
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
  }

  function safeColor(value, fallback) {
    const color = String(value || "");
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback || "#0f8f9f";
  }

  function ageFromBirth(value) {
    if (!value) return null;
    const birth = toLocalDate(value);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const beforeBirthday =
      today.getMonth() < birth.getMonth() ||
      (today.getMonth() === birth.getMonth() &&
        today.getDate() < birth.getDate());
    if (beforeBirthday) age -= 1;
    return Math.max(0, age);
  }

  function isPastDay(value) {
    return String(value || "") < todayKey();
  }

  function invoiceEffectiveStatus(invoice) {
    if (invoice?.effective_status) return invoice.effective_status;
    const paid = invoicePaidCents(invoice);
    if (paid >= Number(invoice?.total_cents || 0) && paid > 0) return "paid";
    if (paid > 0) return "partially_paid";
    const hasSubmittedNotice = (state.data?.bankTransferNotices || []).some(
      (item) =>
        item.invoice_id === invoice?.id && item.status === "submitted",
    );
    if (hasSubmittedNotice) return "processing";
    if (
      invoice.status === "pending" &&
      invoice.due_date &&
      isPastDay(invoice.due_date)
    ) {
      return "overdue";
    }
    return invoice.status;
  }

  function invoicePaymentStatus(invoice) {
    return invoiceEffectiveStatus(invoice) === "paid" ? "paid" : "pending";
  }

  function paymentsForInvoice(invoiceId) {
    return (state.data?.payments || []).filter(
      (item) => item.invoice_id === invoiceId,
    );
  }

  function invoicePaidCents(invoice) {
    if (Number.isFinite(Number(invoice?.paid_cents))) {
      return Math.max(0, Number(invoice.paid_cents));
    }
    return paymentsForInvoice(invoice?.id).reduce((sum, payment) => {
      if (
        !["completed", "partially_refunded", "refunded"].includes(
          payment.status,
        )
      ) {
        return sum;
      }
      return (
        sum +
        Math.max(
          0,
          Number(payment.amount_cents || 0) -
            Number(payment.refunded_cents || 0),
        )
      );
    }, 0);
  }

  function invoiceOutstandingCents(invoice) {
    if (Number.isFinite(Number(invoice?.outstanding_cents))) {
      return Math.max(0, Number(invoice.outstanding_cents));
    }
    return Math.max(
      0,
      Number(invoice?.total_cents || 0) - invoicePaidCents(invoice),
    );
  }

  function invoiceCanBeVoided(invoice) {
    if (!invoice || invoiceEffectiveStatus(invoice) === "void") return false;
    const hasActivePayment = paymentsForInvoice(invoice.id).some(
      (payment) => !["failed", "cancelled"].includes(payment.status),
    );
    const hasActiveNotice = (state.data?.bankTransferNotices || []).some(
      (notice) =>
        notice.invoice_id === invoice.id &&
        ["submitted", "verified"].includes(notice.status),
    );
    return !hasActivePayment && !hasActiveNotice;
  }

  function invoiceReminderThresholdReached(invoice) {
    return Boolean(
      invoice?.due_date &&
        dateKey(addDays(invoice.due_date, 5)) <= todayKey(),
    );
  }

  function paymentReminderForInvoice(invoiceId) {
    return (state.data?.paymentReminders || []).find(
      (reminder) => reminder.invoice_id === invoiceId,
    );
  }

  function invoiceHasSettlementInProgress(invoice) {
    if (!invoice) return false;
    const hasSubmittedBankTransfer = (
      state.data?.bankTransferNotices || []
    ).some(
      (notice) =>
        notice.invoice_id === invoice.id && notice.status === "submitted",
    );
    const hasPendingPaypalPayment = paymentsForInvoice(invoice.id).some(
      (payment) =>
        payment.provider === "paypal" &&
        ["pending", "capturing"].includes(payment.status),
    );
    return hasSubmittedBankTransfer || hasPendingPaypalPayment;
  }

  function invoiceIsReminderEligible(invoice) {
    const status = invoiceEffectiveStatus(invoice);
    return (
      invoiceReminderThresholdReached(invoice) &&
      invoiceOutstandingCents(invoice) > 0 &&
      !invoiceHasSettlementInProgress(invoice) &&
      ["overdue", "partially_paid"].includes(status)
    );
  }

  function canSendPaymentReminder(invoice) {
    return (
      state.data?.paymentRemindersAvailable !== false &&
      invoiceIsReminderEligible(invoice) &&
      familyLinkedAccessEmails(invoice.family_id).length > 0 &&
      !paymentReminderForInvoice(invoice.id)
    );
  }

  function activePaymentReminderEntries(studentId) {
    return (state.data?.paymentReminders || [])
      .map((reminder) => {
        const invoice = state.data?.invoices?.find(
          (item) => item.id === reminder.invoice_id,
        );
        return { reminder, invoice };
      })
      .filter(({ invoice }) => {
        if (
          !invoice ||
          (studentId && invoice.student_id && invoice.student_id !== studentId)
        ) {
          return false;
        }
        return (
          invoiceOutstandingCents(invoice) > 0 &&
          !invoiceHasSettlementInProgress(invoice) &&
          !["paid", "void", "refunded", "processing"].includes(
            invoiceEffectiveStatus(invoice),
          )
        );
      })
      .sort(
        (a, b) =>
          new Date(b.reminder.sent_at || b.reminder.created_at || 0) -
          new Date(a.reminder.sent_at || a.reminder.created_at || 0),
      );
  }

  function makeupEffectiveStatus(credit) {
    if (
      ["available", "proposed"].includes(credit?.status) &&
      credit.expires_on &&
      isPastDay(credit.expires_on)
    ) {
      return "expired";
    }
    return credit?.status;
  }

  function supportActions() {
    return `
      <div class="support-actions">
        <a class="btn btn--secondary btn--sm" href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer">${icon("help", 15)} Parlane con Valeria</a>
        <a class="btn btn--secondary btn--sm" href="${TIDYCAL_URL}" target="_blank" rel="noopener noreferrer">${icon("calendar", 15)} Fissa un colloquio</a>
      </div>
    `;
  }

  function whatsappUrl(message) {
    const url = new URL(WHATSAPP_URL);
    url.searchParams.set("text", String(message || ""));
    return url.toString();
  }

  const LABELS = {
    plan: {
      trial: "Lezione di prova",
      trial_package_2: "Pacchetto prova · 2 lezioni",
      monthly: "Mensile",
      quarterly: "Trimestrale",
      semester: "Semestrale",
      annual: "Annuale",
      workshop: "Laboratorio",
      custom: "Personalizzato",
    },
    attendance: {
      present: "Presente",
      absent_excused: "Assenza avvisata",
      absent_unexcused: "Assenza non avvisata",
      pending: "Da registrare",
    },
    invoice: {
      paid: "Pagato",
      pending: "Da pagare",
    },
    lessonType: {
      regular: "Lezione",
      makeup: "Recupero",
      recovery: "Recupero",
      trial: "Prova",
      event: "Laboratorio",
      extra: "Extra",
    },
    lessonStatus: {
      scheduled: "In programma",
      completed: "Svolta",
      cancelled_teacher: "Annullata docente",
      cancelled_holiday: "Festività",
      cancelled_other: "Annullata",
    },
    makeup: {
      available: "Disponibile",
      proposed: "Proposto",
      scheduled: "Prenotato",
      used: "Utilizzato",
      expired: "Scaduto",
      not_eligible: "Non previsto",
    },
    paymentMethod: {
      paypal: "PayPal",
      bank_transfer: "bonifico",
      cash: "contanti",
      other: "altro",
    },
  };

  const COURSE_WEEKDAYS = {
    1: "Lunedì",
    2: "Martedì",
    3: "Mercoledì",
    4: "Giovedì",
    5: "Venerdì",
    6: "Sabato",
    7: "Domenica",
  };

  function courseScheduleConfigured(course) {
    return Boolean(
      course?.starts_on &&
        course?.ends_on &&
        course?.weekday &&
        course?.start_time,
    );
  }

  function courseStartTime(course) {
    return String(course?.start_time || "").slice(0, 5);
  }

  function courseTimeRange(course) {
    const start = courseStartTime(course);
    const parts = start.split(":").map(Number);
    if (parts.length !== 2 || parts.some(Number.isNaN)) return start || "—";
    const endMinutes =
      parts[0] * 60 + parts[1] + Number(course?.duration_minutes || 0);
    const end = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
    return `${start}–${end}`;
  }

  const SCHOOL_CLOSURE_TITLE = "Chiusura per festività";

const SCHOOL_CLOSURE_FAMILY_NOTE =
  "La giornata non è conteggiata tra le lezioni, non risulta come assenza e non genera recuperi.";


/* =========================================================
   CHIUSURE AUTOMATICHE A.S. 2026-2027
   ========================================================= */

function automaticSchoolClosureRange(startDate, endDate, description) {
  const closures = [];

  const current = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);

  while (current <= end) {
    const closureDate = current.toISOString().slice(0, 10);

    closures.push({
      id: `automatic-${closureDate}`,
      closure_date: closureDate,
      description,
      automatic: true,
      is_automatic: true,
    });

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return closures;
}


function automaticSchoolClosures() {
  return [
    /* 1 novembre 2026 */
    {
      id: "automatic-2026-11-01",
      closure_date: "2026-11-01",
      description:
        "Oggi non ci sono lezioni. Buona festa di Ognissanti!",
      automatic: true,
      is_automatic: true,
    },

    /* 8 dicembre 2026 */
    {
      id: "automatic-2026-12-08",
      closure_date: "2026-12-08",
      description:
        "Oggi non ci sono lezioni. Buona Festa dell’Immacolata!",
      automatic: true,
      is_automatic: true,
    },

    /* Vacanze natalizie: 24 dicembre 2026 - 6 gennaio 2027 */
    ...automaticSchoolClosureRange(
      "2026-12-24",
      "2027-01-06",
      "Non ci sono lezioni in questo periodo. Buone feste natalizie! 🎄",
    ),

    /* Pasqua: 27 - 29 marzo 2027 */
    ...automaticSchoolClosureRange(
      "2027-03-27",
      "2027-03-29",
      "Non ci sono lezioni in questo periodo. Buona Pasqua! 🐣",
    ),

    /* 25 aprile 2027 */
    {
      id: "automatic-2027-04-25",
      closure_date: "2027-04-25",
      description:
        "Oggi non ci sono lezioni. Buon 25 aprile!",
      automatic: true,
      is_automatic: true,
    },

    /* 1 maggio 2027 */
    {
      id: "automatic-2027-05-01",
      closure_date: "2027-05-01",
      description:
        "Oggi non ci sono lezioni. Buon Primo Maggio!",
      automatic: true,
      is_automatic: true,
    },

    /* 2 giugno 2027 */
    {
      id: "automatic-2027-06-02",
      closure_date: "2027-06-02",
      description:
        "Oggi non ci sono lezioni. Buona Festa della Repubblica!",
      automatic: true,
      is_automatic: true,
    },

    /* Tutto agosto 2027 */
    ...automaticSchoolClosureRange(
      "2027-08-01",
      "2027-08-31",
      "Pausa estiva: ad agosto non ci sono lezioni. Ci rivediamo a settembre! ☀️",
    ),
  ];
}


/* =========================================================
   RICERCA CHIUSURA PER DATA
   ========================================================= */

function schoolClosureForDate(value) {
  if (!value) return null;

  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? String(value)
    : dateKey(value);

  /*
   * Prima controlliamo le chiusure automatiche.
   * In questo modo le festività da regolamento non possono
   * essere accidentalmente ignorate.
   */
  const automaticClosure = automaticSchoolClosures().find(
    (closure) => closure.closure_date === key,
  );

  if (automaticClosure) {
    return automaticClosure;
  }

  /*
   * Poi controlliamo le eventuali chiusure inserite
   * manualmente dall'amministratore.
   */
  return (
    (state.data?.schoolClosures || []).find(
      (closure) => closure.closure_date === key,
    ) || null
  );
}


/* =========================================================
   LEZIONI SU GIORNI DI CHIUSURA
   ========================================================= */

function lessonIsOnSchoolClosure(lesson) {
  return Boolean(
    lesson &&
      schoolClosureForDate(
        lesson.occurrence_on || lesson.starts_at,
      ),
  );
}


/* =========================================================
   TESTI MOSTRATI ALLA FAMIGLIA
   ========================================================= */

function schoolClosureDescription(closure) {
  return String(closure?.description || "").trim();
}


function schoolClosureFamilyDescription(closure) {
  const description = schoolClosureDescription(closure);

  return `${description ? `${description} ` : ""}${SCHOOL_CLOSURE_FAMILY_NOTE}`;
}


/* =========================================================
   CHIUSURE RILEVANTI PER UN SINGOLO ALLIEVO
   ========================================================= */

function schoolClosuresForStudent(studentId) {
  if (!state.data || !studentId) return [];

  const enrollments = enrollmentsForStudent(studentId);

  /*
   * Uniamo chiusure manuali e automatiche.
   * Se per errore esistono entrambe sulla stessa data,
   * prevale quella automatica prevista dal regolamento.
   */
  const closuresByDate = new Map();

  (state.data.schoolClosures || []).forEach((closure) => {
    closuresByDate.set(closure.closure_date, closure);
  });

  automaticSchoolClosures().forEach((closure) => {
    closuresByDate.set(closure.closure_date, closure);
  });

  return [...closuresByDate.values()]
    .filter((closure) =>
      enrollments.some((enrollment) => {
        const course = state.data.courses.find(
          (item) => item.id === enrollment.course_id,
        );

        const closureDate = closure.closure_date;

        if (
          (enrollment.starts_on &&
            closureDate < enrollment.starts_on) ||
          (enrollment.ends_on &&
            closureDate > enrollment.ends_on)
        ) {
          return false;
        }

        if (!course) return false;

        if (!courseScheduleConfigured(course)) {
          return true;
        }

        const closureWeekday =
          toLocalDate(closureDate).getDay() || 7;

        return (
          closureWeekday === Number(course.weekday) &&
          closureDate >= course.starts_on &&
          closureDate <= course.ends_on
        );
      }),
    )
    .sort((a, b) =>
      a.closure_date.localeCompare(b.closure_date),
    );
}

  function paymentMethodLabel(method) {
    return LABELS.paymentMethod[method] || method || "metodo non indicato";
  }

  function statusBadge(type, status) {
    const label = (LABELS[type] && LABELS[type][status]) || status || "—";
    let modifier = "plain";
    if (["paid", "present", "completed", "used"].includes(status)) {
      modifier = "success";
    } else if (
      ["overdue", "absent_unexcused", "expired", "cancelled_other", "void"].includes(
        status,
      )
    ) {
      modifier = "danger";
    } else if (
      ["pending", "absent_excused", "available", "proposed"].includes(status)
    ) {
      modifier = "warning";
    } else if (
      ["scheduled", "processing", "partially_paid"].includes(status)
    ) {
      modifier = "info";
    } else if (["not_eligible", "cancelled_holiday"].includes(status)) {
      modifier = "plain";
    }
    return `<span class="badge badge--${modifier}">${escapeHTML(label)}</span>`;
  }

  function courseForStudent(studentId) {
    if (!state.data) return null;
    const enrollment = state.data.enrollments.find(
      (item) => item.student_id === studentId && item.is_active !== false,
    );
    return enrollment
      ? state.data.courses.find((item) => item.id === enrollment.course_id)
      : null;
  }

  function enrollmentForStudent(studentId) {
    return state.data
      ? state.data.enrollments.find(
          (item) => item.student_id === studentId && item.is_active !== false,
        )
      : null;
  }

  function enrollmentsForStudent(studentId) {
    return state.data
      ? state.data.enrollments.filter((item) => item.student_id === studentId)
      : [];
  }

  function enrollmentForLessonStudent(studentId, lesson) {
    const lessonDay = lesson ? dateKey(lesson.starts_at) : todayKey();
    return enrollmentsForStudent(studentId)
      .filter(
        (item) =>
          (!lesson || item.course_id === lesson.course_id) &&
          (!item.starts_on || item.starts_on <= lessonDay) &&
          (!item.ends_on || item.ends_on >= lessonDay),
      )
      .sort((a, b) =>
        String(b.starts_on || "").localeCompare(String(a.starts_on || "")),
      )[0];
  }

  function recoveryAllowedForEnrollment(enrollment) {
    return (
      enrollment?.recovery_allowed ??
      ["quarterly", "annual", "semester"].includes(enrollment?.plan_type)
    );
  }

  function recoveryNoticeHoursForEnrollment(enrollment) {
    return Number(
      enrollment?.recovery_notice_hours ??
        state.data?.settings?.absence_notice_hours ??
        24,
    );
  }

  function familyForStudent(student) {
    return student && state.data
      ? state.data.families.find((item) => item.id === student.family_id)
      : null;
  }

  function familyLinkedAccessEmails(familyOrId) {
    const family = typeof familyOrId === "string"
      ? state.data?.families?.find((item) => item.id === familyOrId)
      : familyOrId;
    if (!family) return [];
    return normalizeEmailList(
      (state.data?.familyUsers || [])
      .filter((item) => item.family_id === family.id)
      .map((item) => {
        const profile = Array.isArray(item.profile)
          ? item.profile[0]
          : item.profile;
        return profile?.is_active === false ? "" : profile?.email;
      }),
    ).filter(
      (email) => isValidEmail(email) && !email.endsWith("@invalid.local"),
    );
  }

  function familyPendingAccessEmails(familyOrId) {
    const family = typeof familyOrId === "string"
      ? state.data?.families?.find((item) => item.id === familyOrId)
      : familyOrId;
    if (!family) return [];
    return normalizeEmailList(
      (state.data?.familyAccessEmails || [])
        .filter((item) => item.family_id === family.id)
        .map((item) => item.email),
    ).filter(
      (email) => isValidEmail(email) && !email.endsWith("@invalid.local"),
    );
  }

  function familyAccessEmails(familyOrId) {
    const family = typeof familyOrId === "string"
      ? state.data?.families?.find((item) => item.id === familyOrId)
      : familyOrId;
    if (!family) return [];
    return normalizeEmailList([
      family.email,
      ...familyPendingAccessEmails(family),
      ...familyLinkedAccessEmails(family),
    ]).filter(
      (email) => isValidEmail(email) && !email.endsWith("@invalid.local"),
    );
  }

  function familyAccountStatusKey(familyId, email) {
    return `${familyId}:${String(email || "").trim().toLowerCase()}`;
  }

  function familyAccountStatus(familyId, email) {
    return (
      state.familyAccountStatuses[familyAccountStatusKey(familyId, email)] ||
      { status: "unknown" }
    );
  }

  function rememberFamilyAccountStatuses(familyId, accounts) {
    (accounts || []).forEach((account) => {
      const email = normalizeEmailList([account?.email])[0];
      if (!email) return;
      state.familyAccountStatuses[familyAccountStatusKey(familyId, email)] = {
        ...account,
        email,
        status: String(account.status || account.account_status || "unknown"),
      };
    });
  }

  function studentForInvoice(invoice) {
    return state.data
      ? state.data.students.find((item) => item.id === invoice?.student_id)
      : null;
  }

  function courseForLesson(lesson) {
    return state.data
      ? state.data.courses.find((item) => item.id === lesson.course_id)
      : null;
  }

  function studentsForLesson(lesson) {
    if (!state.data) return [];
    const isMakeupSession = ["makeup", "recovery"].includes(
      lesson.lesson_type,
    );
    const studentIds = new Set();
    if (!isMakeupSession) {
      state.data.enrollments
        .filter(
          (item) =>
            item.course_id === lesson.course_id &&
            (!item.starts_on || item.starts_on <= dateKey(lesson.starts_at)) &&
            (!item.ends_on || item.ends_on >= dateKey(lesson.starts_at)) &&
            (item.is_active !== false || Boolean(item.ends_on)),
        )
        .forEach((item) => studentIds.add(item.student_id));
    }
    state.data.makeupCredits
      .filter(
        (item) =>
          item.used_lesson_id === lesson.id &&
          ["scheduled", "used"].includes(item.status),
      )
      .forEach((item) => studentIds.add(item.student_id));
    state.data.attendance
      .filter((item) => item.lesson_id === lesson.id)
      .forEach((item) => studentIds.add(item.student_id));
    return state.data.students
      .filter(
        (item) =>
          studentIds.has(item.id) &&
          (item.is_active !== false ||
            dateKey(lesson.starts_at) <= todayKey() ||
            Boolean(attendanceFor(lesson.id, item.id))),
      )
      .sort((a, b) => fullName(a).localeCompare(fullName(b), "it"));
  }

  function attendanceFor(lessonId, studentId) {
    return state.data
      ? state.data.attendance.find(
          (item) =>
            item.lesson_id === lessonId && item.student_id === studentId,
        )
      : null;
  }

  function canRescheduleLesson(lesson) {
    if (
      !state.data ||
      !lesson ||
      lesson.status !== "scheduled" ||
      lesson.origin === "course_schedule" ||
      ["makeup", "recovery"].includes(lesson.lesson_type)
    ) {
      return false;
    }
    const hasRecordedAttendance = state.data.attendance.some(
      (item) =>
        item.lesson_id === lesson.id &&
        item.status &&
        item.status !== "pending",
    );
    const hasLinkedMakeup = state.data.makeupCredits.some(
      (item) =>
        item.source_lesson_id === lesson.id ||
        item.used_lesson_id === lesson.id,
    );
    return !hasRecordedAttendance && !hasLinkedMakeup;
  }

  function setLocalAttendance(
    lessonId,
    studentId,
    status,
    absenceNotifiedAt,
  ) {
    const existing = attendanceFor(lessonId, studentId);
    if (existing) {
      Object.assign(existing, {
        status,
        absence_notified_at: absenceNotifiedAt || null,
        recorded_at: new Date().toISOString(),
      });
      return existing;
    }
    const row = {
      id: `local-${lessonId}-${studentId}`,
      lesson_id: lessonId,
      student_id: studentId,
      status,
      absence_notified_at: absenceNotifiedAt || null,
      recorded_at: new Date().toISOString(),
      notes: "",
    };
    state.data.attendance.push(row);
    return row;
  }

  function studentAttendanceStats(studentId) {
    if (!state.data) return { present: 0, absent: 0, total: 0, rate: 0 };
    const countableLessonIds = new Set(
      state.data.lessons
        .filter(
          (lesson) =>
            !String(lesson.status).startsWith("cancelled") &&
            !lessonIsOnSchoolClosure(lesson),
        )
        .map((lesson) => lesson.id),
    );
    const rows = state.data.attendance.filter(
      (item) =>
        item.student_id === studentId &&
        countableLessonIds.has(item.lesson_id),
    );
    const present = rows.filter((item) => item.status === "present").length;
    const absent = rows.filter((item) =>
      ["absent_excused", "absent_unexcused"].includes(item.status),
    ).length;
    const total = present + absent;
    return {
      present,
      absent,
      total,
      rate: total ? Math.round((present / total) * 100) : 0,
    };
  }

  function getSelectedStudent() {
    if (!state.data) return null;
    let student = state.data.students.find(
      (item) => item.id === state.selectedStudentId,
    );
    if (!student) {
      student = state.data.students[0] || null;
      state.selectedStudentId = student ? student.id : null;
    }
    return student;
  }

  function toast(title, message, type) {
    const toastId = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const element = document.createElement("div");
    element.className = `toast${type === "error" ? " is-error" : ""}`;
    element.id = toastId;
    element.innerHTML = `
      <span class="toast__icon">${icon(type === "error" ? "alert" : "checkSimple", 16)}</span>
      <span class="toast__copy">
        <strong>${escapeHTML(title)}</strong>
        ${message ? `<span>${escapeHTML(message)}</span>` : ""}
      </span>
      <button class="toast__close" type="button" data-action="dismiss-toast" data-toast-id="${toastId}" aria-label="Chiudi">${icon("x", 15)}</button>
    `;
    toastRoot.appendChild(element);
    window.setTimeout(() => {
      document.getElementById(toastId)?.remove();
    }, 5000);
  }

  function setButtonLoading(button, loading, label) {
    if (!button) return;
    if (loading) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="btn__spinner"></span>${escapeHTML(label || "Salvataggio…")}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  let modalReturnFocus = null;

  function openModal(options) {
    if (!modalRoot.innerHTML) modalReturnFocus = document.activeElement;
    const className = options.className ? ` ${options.className}` : "";
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-action="modal-backdrop">
        <section class="modal${className}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <header class="modal__header">
            <div>
              <h2 id="modal-title">${escapeHTML(options.title || "")}</h2>
              ${options.subtitle ? `<p>${escapeHTML(options.subtitle)}</p>` : ""}
            </div>
            <button class="modal__close" type="button" data-action="close-modal" aria-label="Chiudi">${icon("x", 18)}</button>
          </header>
          <div class="modal__body">${options.body || ""}</div>
          ${options.footer ? `<footer class="modal__footer">${options.footer}</footer>` : ""}
        </section>
      </div>
    `;
    document.body.classList.add("modal-open");
    window.setTimeout(() => {
      (
        modalRoot.querySelector(
          ".modal__body input:not([type='hidden']):not([disabled]), .modal__body select:not([disabled]), .modal__body textarea:not([disabled])",
        ) || modalRoot.querySelector(".modal__footer button, .modal__close")
      )?.focus();
    }, 30);
  }

  function closeModal() {
    modalRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  function brandLockup(variant = "sidebar") {
    const areaLabel = state.data
      ? state.role === ROLE_ADMIN
        ? "Area amministrativa"
        : "Area famiglie"
      : "Area corsi";
    if (variant === "full") {
      return `
        <span class="brand-lockup brand-lockup--full">
          <img class="brand-lockup__full-logo" src="assets/img/logo-quarto-movimento-full.png" alt="Quarto MoVimento" />
          <span class="brand-lockup__label">${escapeHTML(areaLabel)}</span>
        </span>
      `;
    }
    return `
      <span class="brand-lockup${variant === "compact" ? " mobile-brand" : ""}">
        <img class="brand-mark" src="assets/img/logo-quarto-movimento.png" alt="" aria-hidden="true" />
        <span class="brand-lockup__text">
          <span class="brand-lockup__name">Quarto MoVimento</span>
          <span class="brand-lockup__label">${escapeHTML(areaLabel)}</span>
        </span>
      </span>
    `;
  }

  // Le date scelte dall'amministratrice sono giorni "civili": le fissiamo a
  // mezzogiorno locale così il timestamp resta sullo stesso giorno anche
  // quando viene riletto in fuso Europe/Rome.
  function paymentPaidAtISO(paidOn) {
    if (!paidOn) return new Date().toISOString();
    const date = toLocalDate(paidOn);
    if (Number.isNaN(date.getTime())) return new Date().toISOString();
    return date.toISOString();
  }

  // PostgREST segnala una RPC assente ora come "does not exist" ora come
  // "Could not find the function ... in the schema cache".
  function isMissingFunctionError(error, functionName) {
    const message = error?.message || "";
    if (functionName && !message.includes(functionName)) return false;
    return /does not exist|non esiste|could not find|schema cache/i.test(
      message,
    );
  }

  class DemoStore {
    constructor() {
      this.data = window.QM_DEMO.createDemoData();
      if (!Array.isArray(this.data.schoolClosures)) {
        this.data.schoolClosures = [];
      }
    }

    async loadData(role) {
      const copy =
        typeof structuredClone === "function"
          ? structuredClone(this.data)
          : JSON.parse(JSON.stringify(this.data));
      if (role === ROLE_FAMILY) {
        const familyId = "fam-1";
        const studentIds = copy.students
          .filter(
            (item) => item.family_id === familyId && item.is_active !== false,
          )
          .map((item) => item.id);
        copy.families = copy.families.filter((item) => item.id === familyId);
        copy.familyUsers = (copy.familyUsers || []).filter(
          (item) => item.family_id === familyId,
        );
        copy.familyAccessEmails = (copy.familyAccessEmails || []).filter(
          (item) => item.family_id === familyId,
        );
        copy.students = copy.students.filter((item) =>
          studentIds.includes(item.id),
        );
        copy.enrollments = copy.enrollments.filter((item) =>
          studentIds.includes(item.student_id),
        );
        const courseIds = copy.enrollments.map((item) => item.course_id);
        copy.courses = copy.courses.filter((item) =>
          courseIds.includes(item.id),
        );
        copy.lessons = copy.lessons.filter((item) =>
          courseIds.includes(item.course_id),
        );
        const lessonIds = copy.lessons.map((item) => item.id);
        copy.attendance = copy.attendance.filter(
          (item) =>
            studentIds.includes(item.student_id) &&
            lessonIds.includes(item.lesson_id),
        );
        copy.invoices = copy.invoices.filter(
          (item) =>
            item.family_id === familyId &&
            (!item.student_id || studentIds.includes(item.student_id)),
        );
        const invoiceIds = copy.invoices.map((item) => item.id);
        copy.payments = copy.payments.filter((item) =>
          invoiceIds.includes(item.invoice_id),
        );
        copy.bankTransferNotices = copy.bankTransferNotices.filter((item) =>
          invoiceIds.includes(item.invoice_id),
        );
        copy.paymentReminders = (copy.paymentReminders || []).filter((item) =>
          invoiceIds.includes(item.invoice_id),
        );
        copy.makeupCredits = copy.makeupCredits.filter((item) =>
          studentIds.includes(item.student_id),
        );
      }
      return copy;
    }

    async loadMakeupCredits() {
      return typeof structuredClone === "function"
        ? structuredClone(this.data.makeupCredits)
        : JSON.parse(JSON.stringify(this.data.makeupCredits));
    }

    async saveStudent(payload) {
      const now = Date.now();
      let familyId = payload.family_id;
      if (!familyId) {
        const normalizedEmail = normalizeEmailList([payload.email])[0] || "";
        const matchingFamilies = this.data.families.filter(
          (item) =>
            normalizeEmailList([item.email])[0] === normalizedEmail ||
            (this.data.familyAccessEmails || []).some(
              (candidate) =>
                candidate.family_id === item.id &&
                normalizeEmailList([candidate.email])[0] === normalizedEmail,
            ) ||
            (this.data.familyUsers || []).some((access) => {
              const profile = Array.isArray(access.profile)
                ? access.profile[0]
                : access.profile;
              return (
                access.family_id === item.id &&
                normalizeEmailList([profile?.email])[0] === normalizedEmail
              );
            }),
        );
        if (matchingFamilies.length > 1) {
          throw new Error(
            "Esistono più famiglie con questa e-mail: seleziona il nucleo esistente.",
          );
        }
        familyId = matchingFamilies[0]?.id || `fam-${now}`;
        if (!matchingFamilies.length) {
          this.data.families.push({
            id: familyId,
            display_name:
              payload.family_display_name ||
              `Famiglia ${payload.last_name || payload.guardian_name}`,
            guardian_name: payload.guardian_name,
            email: normalizedEmail,
            phone: payload.phone,
            notes: "",
          });
        }
      } else {
        const family = this.data.families.find((item) => item.id === familyId);
        if (family) {
          Object.assign(family, {
            display_name:
              payload.family_display_name ||
              family.display_name ||
              `Famiglia ${payload.last_name || payload.guardian_name}`,
            guardian_name: payload.guardian_name || family.guardian_name,
            email: payload.email || family.email,
            phone: payload.phone || family.phone,
          });
        }
      }
      const family = this.data.families.find((item) => item.id === familyId);
      if (family && !payload.family_id) {
        Object.assign(family, {
          display_name:
            payload.family_display_name || family.display_name,
          guardian_name: payload.guardian_name || family.guardian_name,
          email: payload.email || family.email,
          phone: payload.phone || family.phone,
        });
      }
      this.data.familyAccessEmails = this.data.familyAccessEmails || [];
      const requestedAccessEmails = normalizeEmailList([
        payload.email,
        ...(payload.access_emails || []),
      ]);
      this.data.familyAccessEmails
        .filter((item) => item.family_id === familyId)
        .forEach((item) => {
          item.is_primary = false;
        });
      requestedAccessEmails.forEach((email) => {
        const existingAccess = this.data.familyAccessEmails.find(
          (item) => item.family_id === familyId && item.email === email,
        );
        const values = {
          family_id: familyId,
          email,
          is_primary: email === normalizeEmailList([family?.email])[0],
        };
        if (existingAccess) Object.assign(existingAccess, values);
        else this.data.familyAccessEmails.push(values);
      });
      const studentId = payload.id || `stu-${now}`;
      const existing = this.data.students.find(
        (item) => item.id === studentId,
      );
      const student = {
        id: studentId,
        family_id: familyId,
        first_name: payload.first_name,
        last_name: payload.last_name,
        birth_date: payload.birth_date || null,
        fiscal_code: String(payload.fiscal_code || "")
          .trim()
          .toUpperCase(),
        residence_address: payload.residence_address || "",
        notes: payload.notes || "",
        is_active: true,
      };
      if (existing) Object.assign(existing, student);
      else this.data.students.push(student);

      if (payload.course_id) {
        let enrollment = this.data.enrollments.find(
          (item) => item.student_id === studentId && item.is_active !== false,
        );
        if (enrollment && enrollment.course_id !== payload.course_id) {
          enrollment.is_active = false;
          enrollment.ends_on = dateKey(
            addDays(payload.starts_on || todayKey(), -1),
          );
          enrollment = null;
        }
        const values = {
          id: enrollment?.id || `enr-${now}`,
          student_id: studentId,
          course_id: payload.course_id,
          plan_type: payload.plan_type || "monthly",
          starts_on: payload.starts_on || todayKey(),
          ends_on: payload.ends_on || null,
          notes: payload.enrollment_notes || "",
          is_active: true,
        };
        if (enrollment) Object.assign(enrollment, values);
        else this.data.enrollments.push(values);
      }
      return {
        studentId,
        familyId,
        family: this.data.families.find((item) => item.id === familyId),
        student,
        enrollment: this.data.enrollments.find(
          (item) => item.student_id === studentId && item.is_active !== false,
        ),
      };
    }

    async saveAttendance(lessonId, studentId, status, absenceNotifiedAt) {
      const existing = this.data.attendance.find(
        (item) =>
          item.lesson_id === lessonId && item.student_id === studentId,
      );
      if (existing) {
        existing.status = status;
        existing.absence_notified_at = absenceNotifiedAt || null;
        existing.recorded_at = new Date().toISOString();
      } else {
        this.data.attendance.push({
          id: `att-${Date.now()}-${studentId}`,
          lesson_id: lessonId,
          student_id: studentId,
          status,
          absence_notified_at: absenceNotifiedAt || null,
          notes: "",
          recorded_at: new Date().toISOString(),
        });
      }
      const lesson = this.data.lessons.find((item) => item.id === lessonId);
      if (lesson) {
        const assignedCredit = this.data.makeupCredits.find(
          (credit) =>
            credit.student_id === studentId &&
            credit.used_lesson_id === lessonId &&
            credit.status === "scheduled",
        );
        if (["makeup", "recovery"].includes(lesson.lesson_type)) {
          if (assignedCredit) {
            assignedCredit.status = "used";
            assignedCredit.used_at = new Date().toISOString();
          }
        } else {
          const sourceCredit = this.data.makeupCredits.find(
            (credit) =>
              credit.student_id === studentId &&
              credit.source_lesson_id === lessonId,
          );
          if (status === "present") {
            if (
              sourceCredit &&
              ["available", "not_eligible", "proposed"].includes(
                sourceCredit.status,
              )
            ) {
              sourceCredit.status = "cancelled";
              sourceCredit.reason = "Presenza aggiornata dall’amministratrice";
            }
          } else {
            const lessonDay = dateKey(lesson.starts_at);
            const enrollment = this.data.enrollments.find(
              (item) =>
                item.student_id === studentId &&
                item.course_id === lesson.course_id &&
                (!item.starts_on || item.starts_on <= lessonDay) &&
                (!item.ends_on || item.ends_on >= lessonDay),
            );
            const noticeHours = Number(
              enrollment?.recovery_notice_hours ??
                this.data.settings.absence_notice_hours ??
                24,
            );
            const recoveryAllowed =
              enrollment?.recovery_allowed ??
              ["quarterly", "annual", "semester"].includes(
                enrollment?.plan_type,
              );
            const notifiedInTime =
              absenceNotifiedAt &&
              new Date(absenceNotifiedAt) <=
                new Date(lesson.starts_at).getTime() - noticeHours * 3600000;
            const eligible =
              status === "absent_excused" &&
              recoveryAllowed &&
              notifiedInTime;
            const fallbackExpiry = dateKey(addDays(todayKey(), 180));
            const expiry = [
              enrollment?.ends_on,
              this.data.settings.makeup_deadline,
              fallbackExpiry,
            ]
              .filter(Boolean)
              .sort()[0];
            const values = {
              id:
                sourceCredit?.id ||
                `makeup-${Date.now()}-${studentId}`,
              student_id: studentId,
              source_lesson_id: lessonId,
              used_lesson_id: null,
              status: eligible ? "available" : "not_eligible",
              reason: eligible
                ? "Assenza comunicata nei termini"
                : status === "absent_unexcused"
                  ? "Assenza non giustificata"
                  : !recoveryAllowed
                    ? "Il piano non prevede recuperi"
                    : "Preavviso inferiore al termine previsto",
              expires_on: eligible ? expiry : null,
              created_at:
                sourceCredit?.created_at || new Date().toISOString(),
            };
            if (
              sourceCredit &&
              !["scheduled", "used"].includes(sourceCredit.status)
            ) {
              Object.assign(sourceCredit, values);
            } else if (!sourceCredit) {
              this.data.makeupCredits.push(values);
            }
          }
        }
      }
      if (lesson && lesson.status === "scheduled") {
        const students = ["makeup", "recovery"].includes(lesson.lesson_type)
          ? this.data.makeupCredits.filter(
              (item) => item.used_lesson_id === lesson.id,
            )
          : this.data.enrollments.filter(
              (item) =>
                item.course_id === lesson.course_id &&
                (!item.starts_on ||
                  item.starts_on <= dateKey(lesson.starts_at)) &&
                (!item.ends_on ||
                  item.ends_on >= dateKey(lesson.starts_at)),
            );
        const marked = this.data.attendance.filter(
          (item) => item.lesson_id === lessonId,
        );
        if (students.length && marked.length >= students.length) {
          lesson.status = "completed";
        }
      }
    }

    async saveLesson(payload) {
      const repetitions = [];
      let cursor = toLocalDate(payload.starts_at);
      const repeatUntil = payload.repeat_until
        ? toLocalDate(payload.repeat_until)
        : null;
      let count = 0;
      do {
        const start = new Date(cursor.getTime());
        const end = new Date(
          start.getTime() + Number(payload.duration_minutes || 50) * 60000,
        );
        repetitions.push({
          id: `lesson-${Date.now()}-${count}`,
          course_id: payload.course_id,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          lesson_type: payload.lesson_type || "regular",
          status: "scheduled",
          title: payload.title || "",
          location: payload.location || "",
          notes: payload.notes || "",
          origin: "manual",
          occurrence_on: null,
        });
        cursor = addDays(cursor, 7);
        count += 1;
      } while (
        repeatUntil &&
        dateKey(cursor) <= dateKey(repeatUntil) &&
        count < 52
      );
      this.data.lessons.push(...repetitions);
      return repetitions;
    }

    async updateLesson(payload) {
      const lesson = this.data.lessons.find(
        (item) => item.id === payload.lesson_id,
      );
      if (!lesson) throw new Error("Lezione non trovata.");
      const hasRecordedAttendance = this.data.attendance.some(
        (item) =>
          item.lesson_id === lesson.id &&
          item.status &&
          item.status !== "pending",
      );
      const hasLinkedMakeup = this.data.makeupCredits.some(
        (item) =>
          item.source_lesson_id === lesson.id ||
          item.used_lesson_id === lesson.id,
      );
      if (
        lesson.status !== "scheduled" ||
        ["makeup", "recovery"].includes(lesson.lesson_type) ||
        hasRecordedAttendance ||
        hasLinkedMakeup
      ) {
        throw new Error(
          "Questa lezione non può essere riprogrammata perché ha già presenze o recuperi collegati.",
        );
      }
      const start = new Date(payload.starts_at);
      Object.assign(lesson, {
        starts_at: start.toISOString(),
        ends_at: new Date(
          start.getTime() + Number(payload.duration_minutes || 50) * 60000,
        ).toISOString(),
        title: payload.title || lesson.title,
        location: payload.location || "",
        notes: payload.notes || "",
      });
      return lesson;
    }

    async updateLessonStatus(lessonId, status, cancellationReason) {
      const lesson = this.data.lessons.find((item) => item.id === lessonId);
      if (!lesson) throw new Error("Lezione non trovata.");
      lesson.status = status;
      lesson.cancellation_reason = cancellationReason || null;
      if (String(status).startsWith("cancelled")) {
        this.data.makeupCredits.forEach((credit) => {
          if (
            credit.used_lesson_id === lessonId &&
            credit.status === "scheduled"
          ) {
            credit.used_lesson_id = null;
            credit.status =
              credit.expires_on && isPastDay(credit.expires_on)
                ? "expired"
                : "available";
            credit.reason = [
              credit.reason,
              `Recupero assegnato annullato: ${cancellationReason || "lezione annullata"}`,
            ]
              .filter(Boolean)
              .join(" · ");
          } else if (
            credit.source_lesson_id === lessonId &&
            ["available", "proposed", "not_eligible"].includes(credit.status)
          ) {
            credit.status = "cancelled";
            credit.reason = [
              credit.reason,
              `Lezione di origine annullata: ${cancellationReason || "lezione annullata"}`,
            ]
              .filter(Boolean)
              .join(" · ");
          }
        });
      }
    }

    syncCourseCalendar(course) {
      const now = new Date();
      const hadManaged = this.data.lessons.some(
        (lesson) =>
          lesson.course_id === course.id &&
          lesson.origin === "course_schedule",
      );
      const pruneFrom = hadManaged
        ? todayKey()
        : course.starts_on || todayKey();
      const removableIds = new Set(
        this.data.lessons
          .filter(
            (lesson) =>
              lesson.course_id === course.id &&
              lesson.origin === "course_schedule" &&
              lesson.occurrence_on >= pruneFrom &&
              new Date(lesson.starts_at) >= now &&
              lesson.status === "scheduled" &&
              !this.data.attendance.some(
                (item) => item.lesson_id === lesson.id,
              ) &&
              !this.data.makeupCredits.some(
                (item) =>
                  item.source_lesson_id === lesson.id ||
                  item.used_lesson_id === lesson.id,
              ),
          )
          .map((lesson) => lesson.id),
      );
      this.data.lessons = this.data.lessons.filter(
        (lesson) => !removableIds.has(lesson.id),
      );

      let created = 0;
      if (course.is_active !== false && courseScheduleConfigured(course)) {
        const generateFrom = hadManaged
          ? course.starts_on > todayKey()
            ? course.starts_on
            : todayKey()
          : course.starts_on;
        let cursor = toLocalDate(generateFrom);
        const weekday = Number(course.weekday);
        while ((cursor.getDay() || 7) !== weekday) {
          cursor = addDays(cursor, 1);
        }
        const endDate = toLocalDate(course.ends_on);
        while (cursor <= endDate) {
          const occurrenceOn = dateKey(cursor);
          const startsAt = romeDateTime(
            occurrenceOn,
            courseStartTime(course),
          );
          const alreadyExists = this.data.lessons.some(
            (lesson) =>
              lesson.course_id === course.id &&
              ((lesson.origin === "course_schedule" &&
                lesson.occurrence_on === occurrenceOn) ||
                (lesson.origin !== "course_schedule" &&
                  lesson.starts_at === startsAt.toISOString() &&
                  !String(lesson.status).startsWith("cancelled"))),
          );
          const isClosure = this.data.schoolClosures.some(
            (closure) => closure.closure_date === occurrenceOn,
          );
          if (
            (!hadManaged || startsAt >= now) &&
            !isClosure &&
            !alreadyExists
          ) {
            this.data.lessons.push({
              id: `lesson-course-${course.id}-${occurrenceOn}`,
              course_id: course.id,
              starts_at: startsAt.toISOString(),
              ends_at: new Date(
                startsAt.getTime() + course.duration_minutes * 60000,
              ).toISOString(),
              lesson_type: "regular",
              status: "scheduled",
              title: null,
              location: null,
              notes: "",
              origin: "course_schedule",
              occurrence_on: occurrenceOn,
            });
            created += 1;
          }
          cursor = addDays(cursor, 7);
        }
      }
      this.data.lessons.sort(
        (a, b) => new Date(a.starts_at) - new Date(b.starts_at),
      );
      return {
        created,
        removed: removableIds.size,
        calendar_lessons: this.data.lessons.filter(
          (lesson) =>
            lesson.course_id === course.id &&
            lesson.origin === "course_schedule" &&
            lesson.status === "scheduled",
        ).length,
      };
    }

    async saveCourse(payload) {
      const course = {
        id: payload.id || `course-${Date.now()}`,
        name: payload.name,
        color: payload.color || "#0f8f9f",
        location: payload.location || "Studio Quarto MoVimento",
        duration_minutes: Number(payload.duration_minutes || 50),
        starts_on: payload.starts_on || null,
        ends_on: payload.ends_on || null,
        weekday: payload.weekday ? Number(payload.weekday) : null,
        start_time: payload.start_time || null,
        is_active: true,
      };
      const existing = this.data.courses.find((item) => item.id === course.id);
      if (existing) Object.assign(existing, course);
      else this.data.courses.push(course);
      const sync = this.syncCourseCalendar(existing || course);
      return { course: existing || course, ...sync };
    }

    async saveSchoolClosure(closureDate, description) {
      const normalizedDate = String(closureDate || "");
      const normalizedDescription = String(description || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        throw new Error("Indica una data di chiusura valida.");
      }
      if (normalizedDate < todayKey()) {
        throw new Error(
          "Una chiusura può essere inserita soltanto da oggi in avanti.",
        );
      }
      if (normalizedDescription.length > 120) {
        throw new Error("La descrizione non può superare 120 caratteri.");
      }

      const lessonsOnDate = this.data.lessons.filter(
        (lesson) => dateKey(lesson.starts_at) === normalizedDate,
      );
      const protectedLesson = lessonsOnDate.find(
        (lesson) =>
          (lesson.origin === "course_schedule" &&
            lesson.status !== "scheduled") ||
          (lesson.origin === "manual" && lesson.status === "completed") ||
          this.data.attendance.some((item) => item.lesson_id === lesson.id) ||
          this.data.makeupCredits.some(
            (item) =>
              item.source_lesson_id === lesson.id ||
              item.used_lesson_id === lesson.id,
          ),
      );
      if (protectedLesson) {
        throw new Error(
          "La data contiene una lezione già gestita, presenze o recuperi collegati e non può diventare una chiusura.",
        );
      }
      const affectedCourses = this.data.courses.filter((course) => {
        if (course.is_active === false || !courseScheduleConfigured(course)) {
          return false;
        }
        return (
          normalizedDate >= course.starts_on &&
          normalizedDate <= course.ends_on &&
          (toLocalDate(normalizedDate).getDay() || 7) === Number(course.weekday)
        );
      });
      const manualLessons = this.data.lessons.filter(
        (lesson) =>
          lesson.origin === "manual" &&
          dateKey(lesson.starts_at) === normalizedDate &&
          ["scheduled", "completed"].includes(lesson.status),
      ).length;
      if (manualLessons) {
        throw new Error(
          "La data contiene appuntamenti manuali programmati o già svolti e non può essere segnata come chiusura.",
        );
      }
      this.data.lessons = this.data.lessons.filter(
        (lesson) =>
          !(
            lesson.origin === "course_schedule" &&
            lesson.occurrence_on === normalizedDate &&
            lesson.status === "scheduled"
          ),
      );
      let closure = this.data.schoolClosures.find(
        (item) => item.closure_date === normalizedDate,
      );
      if (closure) {
        closure.description = normalizedDescription;
        closure.updated_at = new Date().toISOString();
      } else {
        closure = {
          id: `closure-${Date.now()}`,
          closure_date: normalizedDate,
          description: normalizedDescription,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.data.schoolClosures.push(closure);
      }
      affectedCourses.forEach((course) => this.syncCourseCalendar(course));
      const protectedLessons = this.data.lessons.filter(
        (lesson) =>
          lesson.origin === "course_schedule" &&
          lesson.occurrence_on === normalizedDate,
      ).length;
      return {
        closure,
        affected_courses: affectedCourses.length,
        manual_lessons: manualLessons,
        protected_lessons: protectedLessons,
      };
    }

    async deleteSchoolClosure(closureId) {
      const index = this.data.schoolClosures.findIndex(
        (closure) => closure.id === closureId,
      );
      if (index < 0) throw new Error("Chiusura non trovata.");
      const [closure] = this.data.schoolClosures.splice(index, 1);
      this.data.courses
        .filter(
          (course) =>
            course.is_active !== false &&
            courseScheduleConfigured(course) &&
            closure.closure_date >= course.starts_on &&
            closure.closure_date <= course.ends_on &&
            (toLocalDate(closure.closure_date).getDay() || 7) ===
              Number(course.weekday),
        )
        .forEach((course) => this.syncCourseCalendar(course));
      const restoredLessons = this.data.lessons.filter(
        (lesson) =>
          lesson.origin === "course_schedule" &&
          lesson.occurrence_on === closure.closure_date &&
          lesson.status === "scheduled",
      ).length;
      return { closure, restored_lessons: restoredLessons };
    }

    async archiveStudent(studentId) {
      const student = this.data.students.find((item) => item.id === studentId);
      if (!student) throw new Error("Allievo non trovato.");
      student.is_active = false;
      this.data.enrollments.forEach((enrollment) => {
        if (enrollment.student_id === studentId && enrollment.is_active !== false) {
          enrollment.is_active = false;
          enrollment.ends_on = enrollment.ends_on || todayKey();
        }
      });
      this.data.makeupCredits.forEach((credit) => {
        if (
          credit.student_id === studentId &&
          ["available", "proposed", "scheduled"].includes(credit.status)
        ) {
          credit.status = "cancelled";
          credit.reason = "Allievo eliminato dall’anagrafica attiva";
        }
      });
    }

    async archiveCourse(courseId) {
      const course = this.data.courses.find((item) => item.id === courseId);
      if (!course) throw new Error("Corso non trovato.");
      course.is_active = false;
      this.data.enrollments.forEach((enrollment) => {
        if (enrollment.course_id === courseId && enrollment.is_active !== false) {
          enrollment.is_active = false;
          enrollment.ends_on = enrollment.ends_on || todayKey();
        }
      });
      this.data.lessons.forEach((lesson) => {
        if (
          lesson.course_id === courseId &&
          lesson.status === "scheduled" &&
          new Date(lesson.starts_at) >= new Date()
        ) {
          lesson.status = "cancelled_other";
          lesson.cancellation_reason = "Corso eliminato";
        }
      });
    }

    async saveInvoice(payload) {
      const invoice = {
        id: `inv-${Date.now()}`,
        family_id: payload.family_id,
        student_id: payload.student_id,
        number:
          payload.number ||
          `QM-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
        title: payload.title,
        description: payload.description || "",
        total_cents: Math.round(Number(payload.amount_eur) * 100),
        currency: "EUR",
        due_date: payload.due_date,
        status: "pending",
        payment_method: null,
        paid_at: null,
      };
      this.data.invoices.push(invoice);
      return invoice;
    }

    async markInvoicePaid(invoiceId, method, paidOn) {
      const invoice = this.data.invoices.find((item) => item.id === invoiceId);
      if (!invoice) throw new Error("Scadenza non trovata.");
      const outstanding = invoiceOutstandingCents(invoice);
      if (outstanding <= 0) return;
      const paidAt = paymentPaidAtISO(paidOn);
      this.data.payments.push({
        id: `pay-${Date.now()}`,
        invoice_id: invoice.id,
        family_id: invoice.family_id,
        amount_cents: outstanding,
        refunded_cents: 0,
        currency: invoice.currency || "EUR",
        method: method || "bank_transfer",
        status: "completed",
        provider: "manual",
        reference: "Registrato dall’amministratrice",
        paid_at: paidAt,
        created_at: new Date().toISOString(),
      });
      invoice.status = "paid";
      invoice.payment_method = method || "bank_transfer";
      invoice.paid_at = paidAt;
    }

    async voidInvoice(invoiceId, reason) {
      const invoice = this.data.invoices.find((item) => item.id === invoiceId);
      if (!invoice) throw new Error("Scadenza non trovata.");
      const hasActivePayment = this.data.payments.some(
        (item) =>
          item.invoice_id === invoiceId &&
          !["failed", "cancelled"].includes(item.status),
      );
      const hasActiveNotice = this.data.bankTransferNotices.some(
        (item) =>
          item.invoice_id === invoiceId &&
          ["submitted", "verified"].includes(item.status),
      );
      if (hasActivePayment || hasActiveNotice) {
        throw new Error(
          "Prima annulla l’incasso o completa la verifica del bonifico collegato.",
        );
      }
      invoice.status = "void";
      invoice.effective_status = "void";
      invoice.payment_method = null;
      invoice.paid_at = null;
      invoice.voided_at = new Date().toISOString();
      invoice.void_reason = reason;
      return invoice;
    }

    async cancelManualPayment(paymentId, reason) {
      const payment = this.data.payments.find((item) => item.id === paymentId);
      if (!payment) throw new Error("Incasso non trovato.");
      if (payment.provider !== "manual" || payment.status !== "completed") {
        throw new Error("Questo incasso non può essere annullato dal gestionale.");
      }
      payment.status = "cancelled";
      payment.provider_status = "CANCELLED_BY_ADMIN";
      payment.metadata = {
        ...(payment.metadata || {}),
        cancelled_by_admin: {
          at: new Date().toISOString(),
          reason,
        },
      };
      if (String(payment.idempotency_key || "").startsWith("bank_notice:")) {
        const noticeId = payment.idempotency_key.slice("bank_notice:".length);
        const notice = this.data.bankTransferNotices.find(
          (item) => item.id === noticeId && item.status === "verified",
        );
        if (notice) {
          notice.status = "rejected";
          notice.reviewed_at = new Date().toISOString();
          notice.review_note = `Incasso annullato: ${reason}`;
        }
      }
      const invoice = this.data.invoices.find(
        (item) => item.id === payment.invoice_id,
      );
      if (invoice) {
        const paid = this.data.payments
          .filter(
            (item) =>
              item.invoice_id === invoice.id &&
              ["completed", "partially_refunded", "refunded"].includes(
                item.status,
              ),
          )
          .reduce(
            (sum, item) =>
              sum +
              Math.max(
                0,
                Number(item.amount_cents || 0) -
                  Number(item.refunded_cents || 0),
              ),
            0,
          );
        invoice.status = paid > 0
          ? paid >= invoice.total_cents
            ? "paid"
            : "partially_paid"
          : isPastDay(invoice.due_date)
            ? "overdue"
            : "pending";
        invoice.effective_status = invoice.status;
        invoice.payment_method = paid > 0 ? invoice.payment_method : null;
        invoice.paid_at = invoice.status === "paid" ? invoice.paid_at : null;
      }
      return payment;
    }

    async sendPaymentReminder(invoiceId) {
      const invoice = this.data.invoices.find((item) => item.id === invoiceId);
      if (!invoice) throw new Error("Scadenza non trovata.");
      if (!invoiceIsReminderEligible(invoice)) {
        throw new Error(
          "Il promemoria è disponibile solo dopo 5 giorni di insoluto.",
        );
      }
      this.data.paymentReminders = this.data.paymentReminders || [];
      if (
        this.data.paymentReminders.some(
          (item) => item.invoice_id === invoiceId,
        )
      ) {
        throw new Error("Il promemoria è già stato inviato.");
      }
      const notification = {
        id: `payment-reminder-${Date.now()}`,
        invoice_id: invoice.id,
        family_id: invoice.family_id,
        student_id: invoice.student_id || null,
        sent_by: "demo-admin",
        sent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      this.data.paymentReminders.unshift(notification);
      return { created: true, reason: "sent", reminder: notification };
    }

    async assignMakeup(creditId, lessonId) {
      const credit = this.data.makeupCredits.find(
        (item) => item.id === creditId,
      );
      if (!credit || credit.status !== "available") {
        throw new Error("Recupero non più disponibile.");
      }
      credit.used_lesson_id = lessonId;
      credit.status = "scheduled";
    }

    async saveSettings(values) {
      Object.assign(this.data.settings, values);
    }

    async createPayPalOrder(invoiceId) {
      return { orderID: `DEMO-${invoiceId}-${Date.now()}` };
    }

    async capturePayPalOrder(invoiceId) {
      await this.markInvoicePaid(invoiceId, "paypal");
      return { status: "COMPLETED" };
    }

    async getFamilyAccountStatuses(payload) {
      const emails = normalizeEmailList(payload?.emails || []);
      return {
        ok: true,
        accounts: emails.map((email) => {
          const familyAccess = (this.data.familyUsers || []).find((item) => {
            const profile = Array.isArray(item.profile)
              ? item.profile[0]
              : item.profile;
            return item.family_id === payload.familyId && profile?.email === email;
          });
          const profile = Array.isArray(familyAccess?.profile)
            ? familyAccess.profile[0]
            : familyAccess?.profile;
          let accountStatus = "missing";
          if (profile?.is_active === false) accountStatus = "disabled";
          else if (profile) {
            accountStatus = profile.auth_confirmed === false
              ? "pending"
              : "active";
          }
          return {
            email,
            account_status: accountStatus,
            account_active: accountStatus === "active",
          };
        }),
      };
    }

    async generateFamilyInviteLink(payload) {
      const email = normalizeEmailList([payload?.email])[0];
      if (!email || email.endsWith("@invalid.local")) {
        const error = new Error("La famiglia non ha un indirizzo e-mail valido.");
        error.code = "family_email_missing";
        throw error;
      }
      const family = this.data.families.find(
        (item) => item.id === payload.familyId,
      );
      if (!family) throw new Error("Famiglia non trovata.");
      if (!familyAccessEmails(family).includes(email)) {
        throw new Error("L’indirizzo non appartiene a questa famiglia.");
      }
      this.data.familyUsers = this.data.familyUsers || [];
      let existing = this.data.familyUsers.find((item) => {
        const profile = Array.isArray(item.profile)
          ? item.profile[0]
          : item.profile;
        return profile?.email === email;
      });
      const existingProfile = Array.isArray(existing?.profile)
        ? existing.profile[0]
        : existing?.profile;
      if (existingProfile?.is_active === false) {
        const error = new Error("Questo account è disattivato.");
        error.code = "user_inactive";
        throw error;
      }
      if (existingProfile?.auth_confirmed !== false && existingProfile) {
        if (existing.family_id !== payload.familyId) {
          this.data.familyUsers.push({ ...existing, family_id: payload.familyId });
        }
        return {
          ok: true,
          account_status: "active",
          account_active: true,
          link_generated: false,
        };
      }
      if (!existing) {
        existing = {
          family_id: payload.familyId,
          user_id: `demo-user-${Date.now()}-${this.data.familyUsers.length}`,
          is_primary: false,
          relationship: null,
          profile: {
            email,
            display_name: payload.guardianName || email.split("@")[0],
            is_active: true,
            auth_confirmed: false,
          },
        };
        this.data.familyUsers.push(existing);
      } else if (existing.family_id !== payload.familyId) {
        this.data.familyUsers.push({ ...existing, family_id: payload.familyId });
      }
      return {
        demo: true,
        ok: true,
        account_status: "pending",
        account_active: false,
        link_generated: true,
        activation_link: `https://demo.quartomovimento.it/invito/${encodeURIComponent(email)}?token=${Date.now()}`,
      };
    }
  }

  class SupabaseStore {
    constructor(client) {
      this.client = client;
    }

    async query(table, columns, modifiers) {
      const pageSize = 500;
      const rows = [];
      let from = 0;
      while (true) {
        let request = this.client.from(table).select(columns || "*");
        if (typeof modifiers === "function") request = modifiers(request);
        const { data, error } = await request.range(
          from,
          from + pageSize - 1,
        );
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return rows;
    }

    async loadProfile(userId) {
      const result = await this.client
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (result.error) throw result.error;
      return result.data;
    }

    async loadPaymentReminders() {
      try {
        const rows = await this.query("payment_reminders", "*", (query) =>
          query.order("sent_at", { ascending: false }),
        );
        return { available: true, rows };
      } catch (error) {
        const message = String(error?.message || "");
        if (
          ["42P01", "PGRST205"].includes(error?.code) ||
          /payment_reminders.*(schema cache|does not exist|non esiste)/i.test(
            message,
          )
        ) {
          return { available: false, rows: [] };
        }
        throw error;
      }
    }

    async loadFamilyAccessEmails(role) {
      if (role !== ROLE_ADMIN) return { available: true, rows: [] };
      try {
        const rows = await this.query(
          "family_access_emails",
          "family_id,email,is_primary,created_at,updated_at",
          (query) => query.order("created_at", { ascending: true }),
        );
        return { available: true, rows };
      } catch (error) {
        const message = String(error?.message || "");
        if (
          ["42P01", "PGRST205"].includes(error?.code) ||
          /family_access_emails.*(schema cache|does not exist|non esiste)/i.test(
            message,
          )
        ) {
          return { available: false, rows: [] };
        }
        throw error;
      }
    }

    async loadData(role) {
      const [
        families,
        familyUsers,
        familyAccessEmailResult,
        students,
        courses,
        enrollments,
        lessons,
        schoolClosures,
        attendance,
        invoices,
        payments,
        bankTransferNotices,
        paymentReminderResult,
        makeupCredits,
        settingRows,
      ] = await Promise.all([
        this.query("families", "*", (query) =>
          query.order("display_name", { ascending: true }),
        ),
        role === ROLE_ADMIN
          ? this.query(
              "family_users",
              "family_id,user_id,is_primary,relationship,profile:profiles!family_users_user_id_fkey(email,display_name,is_active)",
              (query) => query.order("created_at", { ascending: true }),
            )
          : Promise.resolve([]),
        this.loadFamilyAccessEmails(role),
        this.query("students", "*", (query) =>
          query.order("last_name", { ascending: true }),
        ),
        this.query("courses", "*", (query) =>
          query.order("name", { ascending: true }),
        ),
        this.query("enrollments", "*", (query) =>
          query.order("id", { ascending: true }),
        ),
        this.query("lessons", "*", (query) =>
          query.order("starts_at", { ascending: true }),
        ),
        this.query("school_closures", "*", (query) =>
          query.order("closure_date", { ascending: true }),
        ),
        this.query("attendance", "*", (query) =>
          query.order("id", { ascending: true }),
        ),
        this.query("invoice_summaries", "*", (query) =>
          query.order("due_date", { ascending: false }),
        ),
        this.query("payments", "*", (query) =>
          query.order("created_at", { ascending: false }),
        ),
        this.query("bank_transfer_notices", "*", (query) =>
          query.order("created_at", { ascending: false }),
        ),
        this.loadPaymentReminders(),
        this.query("makeup_credits", "*", (query) =>
          query.order("created_at", { ascending: false }),
        ),
        this.query("app_settings", "key,value"),
      ]);
      const settings = Object.fromEntries(
        settingRows.map((item) => [item.key, item.value]),
      );
      return {
        families,
        familyUsers,
        familyAccessEmails: familyAccessEmailResult.rows,
        familyAccessEmailsAvailable: familyAccessEmailResult.available,
        students:
          role === ROLE_FAMILY
            ? students.filter((item) => item.is_active !== false)
            : students,
        courses,
        enrollments,
        lessons,
        schoolClosures,
        attendance,
        invoices,
        payments,
        bankTransferNotices,
        paymentReminders: paymentReminderResult.rows,
        paymentRemindersAvailable: paymentReminderResult.available,
        makeupCredits,
        settings,
      };
    }

    async loadMakeupCredits() {
      return this.query("makeup_credits", "*", (query) =>
        query.order("created_at", { ascending: false }),
      );
    }

    async saveStudent(payload) {
      const { data, error } = await this.client.rpc(
        "admin_upsert_student_family_with_access",
        { p_payload: payload },
      );
      if (error) throw error;
      return {
        ...data,
        studentId: data.student.id,
        familyId: data.family.id,
      };
    }

    async saveAttendance(lessonId, studentId, status, absenceNotifiedAt) {
      const rpcResult = await this.client.rpc("mark_attendance_batch", {
        p_lesson_id: lessonId,
        p_entries: [
          {
            student_id: studentId,
            status,
            absence_notified_at: absenceNotifiedAt || null,
          },
        ],
      });
      if (!rpcResult.error) return rpcResult.data;
      if (!/function .* does not exist/i.test(rpcResult.error.message || "")) {
        throw rpcResult.error;
      }
      const { error } = await this.client.from("attendance").upsert(
        {
          lesson_id: lessonId,
          student_id: studentId,
          status,
          absence_notified_at: absenceNotifiedAt || null,
          recorded_at: new Date().toISOString(),
        },
        { onConflict: "lesson_id,student_id" },
      );
      if (error) throw error;
    }

    async saveLesson(payload) {
      const rows = [];
      let cursor = toLocalDate(payload.starts_at);
      const repeatUntil = payload.repeat_until
        ? toLocalDate(payload.repeat_until)
        : null;
      let count = 0;
      do {
        const start = new Date(cursor.getTime());
        const end = new Date(
          start.getTime() + Number(payload.duration_minutes || 50) * 60000,
        );
        rows.push({
          course_id: payload.course_id,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          lesson_type: payload.lesson_type || "regular",
          status: "scheduled",
          title: payload.title || null,
          location: payload.location || null,
          notes: payload.notes || "",
        });
        cursor = addDays(cursor, 7);
        count += 1;
      } while (
        repeatUntil &&
        dateKey(cursor) <= dateKey(repeatUntil) &&
        count < 52
      );
      const { data, error } = await this.client
        .from("lessons")
        .insert(rows)
        .select();
      if (error) throw error;
      return data;
    }

    async updateLesson(payload) {
      const start = new Date(payload.starts_at);
      const { data, error } = await this.client.rpc("reschedule_lesson", {
        p_lesson_id: payload.lesson_id,
        p_starts_at: start.toISOString(),
        p_ends_at: new Date(
          start.getTime() + Number(payload.duration_minutes || 50) * 60000,
        ).toISOString(),
        p_title: payload.title || null,
        p_location: payload.location || null,
        p_notes: payload.notes || "",
      });
      if (error) throw error;
      return data;
    }

    async updateLessonStatus(lessonId, status, cancellationReason) {
      const { data, error } = await this.client.rpc("update_lesson_status", {
        p_lesson_id: lessonId,
        p_status: status,
        p_cancellation_reason: cancellationReason || null,
      });
      if (!error) return data;
      if (!/function .* does not exist/i.test(error.message || "")) throw error;
      const { error: updateError } = await this.client
        .from("lessons")
        .update({
          status,
          cancellation_reason: cancellationReason || null,
        })
        .eq("id", lessonId);
      if (updateError) throw updateError;
    }

    async saveCourse(payload) {
      const values = {
        id: payload.id || null,
        name: payload.name,
        color: payload.color || "#0f8f9f",
        location: payload.location || "Studio Quarto MoVimento",
        duration_minutes: Number(payload.duration_minutes || 50),
        starts_on: payload.starts_on || null,
        ends_on: payload.ends_on || null,
        weekday: payload.weekday ? Number(payload.weekday) : null,
        start_time: payload.start_time || null,
      };
      const { data, error } = await this.client.rpc("admin_upsert_course", {
        p_payload: values,
      });
      if (error) throw error;
      return data;
    }

    async saveSchoolClosure(closureDate, description) {
      const { data, error } = await this.client.rpc(
        "admin_upsert_school_closure",
        {
          p_closure_date: closureDate,
          p_description: description || null,
        },
      );
      if (error) throw error;
      return data;
    }

    async deleteSchoolClosure(closureId) {
      const { data, error } = await this.client.rpc(
        "admin_delete_school_closure",
        { p_closure_id: closureId },
      );
      if (error) throw error;
      return data;
    }

    async archiveStudent(studentId) {
      const { data, error } = await this.client.rpc("admin_archive_student", {
        p_student_id: studentId,
      });
      if (error) throw error;
      return data;
    }

    async archiveCourse(courseId) {
      const { data, error } = await this.client.rpc("admin_archive_course", {
        p_course_id: courseId,
      });
      if (error) throw error;
      return data;
    }

    async saveInvoice(payload) {
      const values = {
        family_id: payload.family_id,
        student_id: payload.student_id,
        number:
          payload.number ||
          `QM-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
        title: payload.title,
        description: payload.description || "",
        total_cents: Math.round(Number(payload.amount_eur) * 100),
        currency: "EUR",
        due_date: payload.due_date,
        status: "pending",
      };
      const { data, error } = await this.client
        .from("invoices")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    async markInvoicePaid(invoiceId, method, paidOn) {
      const paidAt = paymentPaidAtISO(paidOn);
      const { data, error } = await this.client.rpc("admin_mark_invoice_paid", {
        p_invoice_id: invoiceId,
        p_method: method || "bank_transfer",
        p_paid_at: paidAt,
      });
      if (!error) return data;
      if (!isMissingFunctionError(error, "admin_mark_invoice_paid")) {
        throw error;
      }
      const { error: updateError } = await this.client
        .from("invoices")
        .update({
          status: "paid",
          payment_method: method || "bank_transfer",
          paid_at: paidAt,
        })
        .eq("id", invoiceId);
      if (updateError) throw updateError;
    }

    async voidInvoice(invoiceId, reason) {
      const { data, error } = await this.client.rpc("admin_void_invoice", {
        p_invoice_id: invoiceId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    }

    async cancelManualPayment(paymentId, reason) {
      const { data, error } = await this.client.rpc(
        "admin_cancel_manual_payment",
        {
          p_payment_id: paymentId,
          p_reason: reason,
        },
      );
      if (error) throw error;
      return data;
    }

    async sendPaymentReminder(invoiceId) {
      const { data, error } = await this.client.rpc(
        "admin_send_payment_reminder",
        { p_invoice_id: invoiceId },
      );
      if (error) throw error;
      return data;
    }

    async assignMakeup(creditId, lessonId) {
      const { data, error } = await this.client.rpc("assign_makeup_credit", {
        p_credit_id: creditId,
        p_lesson_id: lessonId,
      });
      if (error) throw error;
      return data;
    }

    async saveSettings(values) {
      const rows = Object.entries(values).map(([key, value]) => ({
        key,
        value,
      }));
      const { error } = await this.client
        .from("app_settings")
        .upsert(rows, { onConflict: "key" });
      if (error) throw error;
    }

    async createPayPalOrder(invoiceId) {
      const { data, error } = await this.client.functions.invoke(
        "paypal-create-order",
        { body: { invoice_id: invoiceId } },
      );
      if (error) throw error;
      return data;
    }

    async capturePayPalOrder(invoiceId, orderId) {
      const { data, error } = await this.client.functions.invoke(
        "paypal-capture-order",
        { body: { invoice_id: invoiceId, order_id: orderId } },
      );
      if (error) throw error;
      return data;
    }

    async invokeFamilyAccess(body) {
      const { data, error } = await this.client.functions.invoke(
        "invite-family",
        { body },
      );
      if (error) {
        let details = null;
        try {
          const response = error.context;
          if (response && typeof response.clone === "function") {
            details = await response.clone().json();
          }
        } catch {
          details = null;
        }
        const familyAccessError = new Error(
          details?.message ||
            details?.error ||
            error.message ||
            "Impossibile gestire l’accesso della famiglia.",
        );
        familyAccessError.code = details?.code || "family_access_failed";
        familyAccessError.retryable = Boolean(details?.retryable);
        throw familyAccessError;
      }
      if (!data || data.ok !== true) {
        const invalidResponse = new Error(
          data?.error || "Risposta non valida dalla funzione di accesso famiglia.",
        );
        invalidResponse.code = data?.code || "invalid_edge_response";
        throw invalidResponse;
      }
      return data;
    }

    async getFamilyAccountStatuses(payload) {
      const requestedEmails = normalizeEmailList(payload.emails || []);
      const data = await this.invokeFamilyAccess({
        action: "status",
        family_id: payload.familyId,
        target_emails: requestedEmails,
      });
      const allowedStatuses = new Set([
        "missing",
        "pending",
        "active",
        "disabled",
        "role_invalid",
      ]);
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      const returnedEmails = normalizeEmailList(
        accounts.map((account) => account?.email),
      );
      if (
        accounts.length !== requestedEmails.length ||
        returnedEmails.length !== requestedEmails.length ||
        requestedEmails.some((email) => !returnedEmails.includes(email)) ||
        accounts.some(
          (account) => !allowedStatuses.has(String(account?.account_status)),
        )
      ) {
        const error = new Error(
          "La funzione non ha restituito uno stato account valido.",
        );
        error.code = "invalid_edge_response";
        throw error;
      }
      return {
        ...data,
        accounts: requestedEmails.map((email) =>
          accounts.find(
            (account) => normalizeEmailList([account?.email])[0] === email,
          ),
        ),
      };
    }

    async generateFamilyInviteLink(payload) {
      const requestedEmail = normalizeEmailList([payload.email])[0] || "";
      const data = await this.invokeFamilyAccess({
        action: "generate_link",
        family_id: payload.familyId,
        target_email: requestedEmail,
      });
      if (
        normalizeEmailList([data.target_email])[0] !== requestedEmail ||
        !["active", "pending"].includes(data.account_status) ||
        (data.account_status !== "active" &&
          (!data.link_generated || !data.activation_link))
      ) {
        const error = new Error(
          "Supabase non ha restituito un link di invito valido.",
        );
        error.code = "invalid_edge_response";
        throw error;
      }
      return data;
    }
  }

  function renderLogin(message) {
    document.title = config.siteName || "Area corsi · Quarto MoVimento";
    appRoot.innerHTML = `
      <main class="login-page" id="main-content">
        <section class="login-panel">
          ${brandLockup("full")}
          <div class="login-panel__content">
            <span class="login-eyebrow">Area riservata</span>
            <h1 class="login-title">Bentornata!</h1>
            <p class="login-subtitle">Lezioni, presenze, recuperi e pagamenti: tutto al posto giusto, con un solo accesso.</p>
            ${message ? `<div class="info-callout" style="margin-bottom:18px">${icon("info", 18)}<p>${escapeHTML(message)}</p></div>` : ""}
            <form class="login-form" id="login-form">
              <div class="field">
                <label for="login-email">Indirizzo e-mail</label>
                <input class="input" id="login-email" name="email" type="email" autocomplete="email" placeholder="nome@email.it" required />
              </div>
              <div class="field">
                <label for="login-password">Password</label>
                <div class="input-group">
                  <input class="input" id="login-password" name="password" type="password" autocomplete="current-password" placeholder="La tua password" required />
                  <button class="input-action" type="button" data-action="toggle-password" aria-label="Mostra password">${icon("eye", 18)}</button>
                </div>
              </div>
              <div class="login-actions">
                <button class="btn btn--primary btn--lg" type="submit">Accedi ${icon("arrowRight", 17)}</button>
                <button class="btn btn--ghost" id="magic-link-button" type="button" data-action="magic-link">Ricevi un link via e-mail</button>
              </div>
              <p class="field-hint" id="auth-email-status">Dopo l’invio attendi 60 secondi prima di richiedere un nuovo link.</p>
            </form>
            <p class="login-helper">
              Il profilo riconosce automaticamente se sei amministratrice o famiglia.
              <button class="copy-button" type="button" data-action="forgot-password">Password dimenticata?</button>
            </p>
            ${supportActions()}
            ${
              state.mode === "demo"
                ? `
                  <div class="demo-access">
                    <span class="demo-access__heading">${icon("music", 16)} Anteprima senza configurazione</span>
                    <div class="demo-access__buttons">
                      <button class="btn btn--secondary btn--sm" type="button" data-action="demo-login" data-role="admin">Esplora come admin</button>
                      <button class="btn btn--secondary btn--sm" type="button" data-action="demo-login" data-role="family">Esplora come famiglia</button>
                    </div>
                  </div>
                `
                : ""
            }
          </div>
          <footer class="login-footer">
            <span>© ${new Date().getFullYear()} Studio Quarto MoVimento</span>
            <span><a href="https://www.quartomovimento.it/dichiarazione-sulla-privacy-ue/" target="_blank" rel="noopener">Privacy</a> · <a href="${escapeHTML(config.websiteUrl || "https://www.quartomovimento.it")}" target="_blank" rel="noopener">Sito web</a></span>
          </footer>
        </section>
        <aside class="login-visual" aria-label="Presentazione">
          <div class="login-visual__inner">
            <span class="visual-note visual-note--one" aria-hidden="true">♫</span>
            <span class="visual-note visual-note--two" aria-hidden="true">♪</span>
            <span class="visual-kicker">Studio Quarto MoVimento</span>
            <h2>La musica accompagna ogni passo.</h2>
            <p class="login-visual__copy">Uno spazio semplice e accogliente per seguire il percorso musicale dei bambini, dalla prossima lezione fino all’ultimo recupero.</p>
            <div class="visual-features">
              <div class="visual-feature">
                <span class="visual-feature__icon">${icon("calendar", 18)}</span>
                <strong>Calendario chiaro</strong>
                <span>Lezioni e recuperi sempre aggiornati.</span>
              </div>
              <div class="visual-feature">
                <span class="visual-feature__icon">${icon("check", 18)}</span>
                <strong>Frequenza</strong>
                <span>Presenze e assenze a colpo d’occhio.</span>
              </div>
              <div class="visual-feature">
                <span class="visual-feature__icon">${icon("wallet", 18)}</span>
                <strong>Pagamenti</strong>
                <span>Scadenze, bonifico e PayPal in un posto.</span>
              </div>
            </div>
          </div>
        </aside>
      </main>
    `;
    window.setTimeout(syncAuthEmailCooldown, 0);
  }

  function routeInfo() {
    const parts = window.location.hash.replace(/^#\/?/, "").split("/");
    const prefix = state.role === ROLE_ADMIN ? "admin" : "famiglia";
    const defaults = state.role === ROLE_ADMIN ? "overview" : "home";
    const allowed = state.role === ROLE_ADMIN ? ADMIN_ROUTES : FAMILY_ROUTES;
    let route = parts[0] === prefix ? parts[1] : defaults;
    if (!allowed.includes(route)) route = defaults;
    return { prefix, route };
  }

  function adminNav() {
    const overdue = state.data.invoices.filter(
      (item) => invoiceEffectiveStatus(item) === "overdue",
    ).length;
    return [
      ["overview", "Riepilogo", "home", null],
      ["attendance", "Presenze", "check", null],
      ["students", "Allievi", "users", null],
      ["calendar", "Calendario", "calendar", null],
      ["courses", "Corsi", "music", null],
      ["makeups", "Recuperi", "repeat", null],
      ["payments", "Pagamenti", "wallet", overdue || null],
      ["settings", "Impostazioni", "settings", null],
    ];
  }

  function familyNav() {
    const pending = state.data.invoices.filter((item) =>
      ["pending", "overdue", "processing", "partially_paid"].includes(
        invoiceEffectiveStatus(item),
      ),
    ).length;
    return [
      ["home", "Home", "home", null],
      ["lessons", "Lezioni", "calendar", null],
      ["attendance", "Frequenza", "check", null],
      ["makeups", "Recuperi", "repeat", null],
      ["payments", "Pagamenti", "wallet", pending || null],
    ];
  }

  function navLink(item, prefix, activeRoute) {
    const [route, label, iconName, badge] = item;
    return `
      <a class="nav-link${activeRoute === route ? " is-active" : ""}" href="#/${prefix}/${route}" data-route="${route}">
        ${icon(iconName, 19)}
        <span>${escapeHTML(label)}</span>
        ${badge ? `<span class="nav-badge">${badge}</span>` : ""}
      </a>
    `;
  }

  function renderShell() {
    const { prefix, route } = routeInfo();
    const nav = state.role === ROLE_ADMIN ? adminNav() : familyNav();
    const displayName =
      state.profile?.display_name ||
      state.profile?.full_name ||
      (state.role === ROLE_ADMIN ? "Valeria" : "Famiglia Bianchi");
    const email = state.user?.email || "anteprima@quartomovimento.it";
    const routeLabel =
      nav.find((item) => item[0] === route)?.[1] || "Area corsi";
    const view =
      state.role === ROLE_ADMIN
        ? renderAdminView(route)
        : renderFamilyView(route);

    document.title = `${routeLabel} · Quarto MoVimento`;
    appRoot.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar">
          ${brandLockup("sidebar")}
          <p class="sidebar-section-label">${state.role === ROLE_ADMIN ? "Gestione scuola" : "La tua area"}</p>
          <nav class="sidebar-nav" aria-label="Navigazione principale">
            ${nav.map((item) => navLink(item, prefix, route)).join("")}
          </nav>
          <div class="sidebar-bottom">
            ${
              state.role === ROLE_FAMILY
                ? `
                  <div class="sidebar-help">
                   <strong>Serve una mano?</strong>
                   <p>Per assenze, cambi orario o dubbi scrivimi direttamente.</p>
                    ${supportActions()}
                  </div>
                `
                : ""
            }
            <div class="sidebar-profile">
              <span class="avatar${state.role === ROLE_ADMIN ? " avatar--orange" : " avatar--aqua"}">${escapeHTML(initials(displayName))}</span>
              <span class="profile-copy">
                <strong>${escapeHTML(displayName)}</strong>
                <span>${escapeHTML(email)}</span>
              </span>
              <button class="sidebar-logout" type="button" data-action="logout" aria-label="Esci">${icon("logout", 17)}</button>
            </div>
          </div>
        </aside>
        <div class="app-main">
          <header class="topbar">
            ${brandLockup("compact")}
            <div class="breadcrumbs">
              <span>${state.role === ROLE_ADMIN ? "Gestione scuola" : "Area famiglia"}</span>
              ${icon("chevronRight", 14)}
              <strong>${escapeHTML(routeLabel)}</strong>
            </div>
            <div class="topbar-actions">
              <span class="topbar-date">${escapeHTML(formatLongDate(new Date()))}</span>
              ${state.role === ROLE_ADMIN ? `<a class="btn btn--secondary btn--icon" href="#/admin/settings" aria-label="Impostazioni">${icon("settings", 18)}</a>` : ""}
              <button class="btn btn--secondary btn--icon" type="button" data-action="logout" aria-label="Esci">${icon("logout", 18)}</button>
            </div>
          </header>
          <main class="content" id="main-content">
            ${
              state.mode === "demo" && state.demoBannerVisible
                ? `
                  <div class="demo-banner">
                    <span><strong>Modalità anteprima:</strong> tutti i nomi e i dati che vedi sono fittizi.</span>
                    <button type="button" data-action="dismiss-demo-banner">Nascondi</button>
                  </div>
                `
                : ""
            }
            ${view}
          </main>
          <nav class="bottom-nav${state.role === ROLE_ADMIN ? " bottom-nav--admin" : ""}" aria-label="Navigazione mobile" style="--nav-count:${Math.min(nav.length, 7)}">
            ${nav
              .slice(0, 7)
              .map((item) => navLink(item, prefix, route))
              .join("")}
          </nav>
        </div>
      </div>
    `;
  }

  function pageHeader(eyebrow, title, description, actions, friendly) {
    return `
      <header class="page-header">
        <div class="page-header__copy">
          <span class="page-eyebrow">${escapeHTML(eyebrow)}</span>
          <h1 class="page-title${friendly ? " page-title--friendly" : ""}">${escapeHTML(title)}</h1>
          ${description ? `<p class="page-description">${escapeHTML(description)}</p>` : ""}
        </div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ""}
      </header>
    `;
  }

  function renderAdminView(route) {
    const views = {
      overview: renderAdminOverview,
      attendance: renderAdminAttendance,
      students: renderAdminStudents,
      calendar: renderAdminCalendar,
      courses: renderAdminCourses,
      makeups: renderAdminMakeups,
      payments: renderAdminPayments,
      settings: renderAdminSettings,
    };
    return (views[route] || renderAdminOverview)();
  }

  function renderFamilyView(route) {
    const views = {
      home: renderFamilyHome,
      lessons: renderFamilyLessons,
      attendance: renderFamilyAttendance,
      makeups: renderFamilyMakeups,
      payments: renderFamilyPayments,
    };
    return (views[route] || renderFamilyHome)();
  }

  // View renderers and event handling continue below.

  function statCard(label, value, meta, iconName, suffix) {
    return `
      <article class="stat-card">
        <div class="stat-card__top">
          <span class="stat-card__label">${escapeHTML(label)}</span>
          <span class="stat-card__icon">${icon(iconName, 17)}</span>
        </div>
        <div class="stat-card__value">
          <strong>${escapeHTML(value)}</strong>
          ${suffix ? `<span>${escapeHTML(suffix)}</span>` : ""}
        </div>
        <p class="stat-card__meta">${escapeHTML(meta)}</p>
      </article>
    `;
  }

  function renderScheduleList(lessons, emptyText) {
    if (!lessons.length) {
      return `
        <div class="empty-state">
          <span class="empty-state__icon">${icon("calendar", 22)}</span>
          <h3>Nessuna lezione</h3>
          <p>${escapeHTML(emptyText || "Non ci sono lezioni in programma.")}</p>
        </div>
      `;
    }
    return `
      <div class="schedule-list">
        ${lessons
          .map((lesson) => {
            const course = courseForLesson(lesson);
            const count = studentsForLesson(lesson).length;
            return `
              <div class="schedule-item">
                <span class="schedule-time">${escapeHTML(formatTime(lesson.starts_at))}</span>
                <span class="schedule-line" style="background:${safeColor(course?.color)}"></span>
                <span class="schedule-copy">
                  <strong>${escapeHTML(lesson.title || course?.name || "Lezione")}</strong>
                  <span>${escapeHTML(lesson.location || course?.location || "Studio Quarto MoVimento")}${lesson.lesson_type === "makeup" || lesson.lesson_type === "recovery" ? " · Recupero" : ""}</span>
                </span>
                <span class="schedule-count">${count} ${count === 1 ? "allievo" : "allievi"}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderAdminOverview() {
    const activeStudents = state.data.students.filter(
      (item) => item.is_active !== false,
    );
    const todayClosure = schoolClosureForDate(todayKey());
    const todayLessons = state.data.lessons
      .filter(
        (item) =>
          dateKey(item.starts_at) === todayKey() &&
          !String(item.status).startsWith("cancelled") &&
          !lessonIsOnSchoolClosure(item),
      )
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const openInvoices = state.data.invoices.filter((item) =>
      ["pending", "overdue", "partially_paid", "processing"].includes(
        invoiceEffectiveStatus(item),
      ),
    );
    const overdueInvoices = openInvoices
      .filter((item) => invoiceEffectiveStatus(item) === "overdue")
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const outstanding = openInvoices.reduce(
      (sum, item) => sum + invoiceOutstandingCents(item),
      0,
    );
    const availableMakeups = state.data.makeupCredits.filter(
      (item) => makeupEffectiveStatus(item) === "available",
    );
    const markedToday = todayLessons.reduce(
      (total, lesson) =>
        total +
        state.data.attendance.filter((item) => item.lesson_id === lesson.id)
          .length,
      0,
    );

    const recentPaid = (state.data.payments || [])
      .filter(
        (item) =>
          ["completed", "partially_refunded"].includes(item.status) &&
          Number(item.amount_cents || 0) - Number(item.refunded_cents || 0) > 0,
      )
      .sort(
        (a, b) =>
          new Date(b.paid_at || b.created_at || 0) -
          new Date(a.paid_at || a.created_at || 0),
      )
      .slice(0, 3);

    return `
      ${pageHeader(
        "Oggi a Quarto MoVimento",
        `Ciao, ${state.profile?.display_name?.split(" ")[0] || "Valeria"}!`,
        "Ecco cosa succede nei corsi e cosa richiede la tua attenzione.",
        `${todayClosure ? `<button class="btn btn--secondary" type="button" data-action="delete-school-closure" data-closure-id="${escapeHTML(todayClosure.id)}">Riapri oggi</button>` : `<button class="btn btn--secondary" type="button" data-action="open-school-closure-modal" data-date="${todayKey()}">${icon("calendar", 16)} Segna chiusura</button>`}<button class="btn btn--primary" type="button" data-action="open-student-modal">${icon("plus", 17)} Nuovo allievo</button>`,
        true,
      )}

      <section class="grid grid--stats" aria-label="Riepilogo">
        ${statCard(
          "Allievi attivi",
          activeStudents.length,
          `${state.data.courses.filter((item) => item.is_active !== false).length} corsi attivi`,
          "users",
        )}
        ${statCard(
          "Lezioni di oggi",
          todayLessons.length,
          todayClosure
            ? SCHOOL_CLOSURE_TITLE
            : markedToday
              ? `${markedToday} presenze già registrate`
              : "Registro da compilare",
          "calendar",
        )}
        ${statCard(
          "Da incassare",
          formatMoney(outstanding),
          `${overdueInvoices.length} ${overdueInvoices.length === 1 ? "scadenza scaduta" : "scadenze scadute"}`,
          "wallet",
        )}
        ${statCard(
          "Recuperi aperti",
          availableMakeups.length,
          "Crediti da programmare",
          "repeat",
        )}
      </section>

      <section class="grid grid--dashboard" style="margin-top:18px">
        <article class="card">
          <header class="card-header">
            <div>
              <h2>Programma di oggi</h2>
              <p>${escapeHTML(formatLongDate(new Date()))}</p>
            </div>
            <a class="btn btn--ghost btn--sm" href="#/admin/attendance">Apri registro ${icon("arrowRight", 14)}</a>
          </header>
          ${
            todayClosure
              ? `<div class="closure-callout">${icon("calendar", 18)}<p><strong>${escapeHTML(SCHOOL_CLOSURE_TITLE)}</strong>${schoolClosureDescription(todayClosure) ? ` · ${escapeHTML(schoolClosureDescription(todayClosure))}` : ""}. Lo studio resta chiuso e il registro non deve essere compilato.</p></div>`
              : renderScheduleList(
                  todayLessons,
                  "Una giornata libera: non risultano lezioni in calendario.",
                )
          }
        </article>

        <article class="card">
          <header class="card-header">
            <div>
              <h2>Da controllare</h2>
              <p>Scadenze e recuperi aperti</p>
            </div>
          </header>
          ${
            overdueInvoices.length
              ? `
                <div class="payment-list">
                  ${overdueInvoices
                    .slice(0, 4)
                    .map((invoice) => {
                      const student = studentForInvoice(invoice);
                      return `
                        <div class="payment-item">
                          <span class="payment-item__copy">
                            <strong>${escapeHTML(fullName(student))}</strong>
                            <span>${escapeHTML(invoice.title)} · scaduta ${escapeHTML(formatDate(invoice.due_date, { day: "numeric", month: "short" }))}</span>
                          </span>
                          <span class="payment-item__amount">
                            <span class="money">${escapeHTML(formatMoney(invoiceOutstandingCents(invoice), invoice.currency))}</span>
                            ${statusBadge("invoice", invoicePaymentStatus(invoice))}
                          </span>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
                <a class="btn btn--secondary btn--sm" style="width:100%;margin-top:12px" href="#/admin/payments">Vedi tutti i pagamenti</a>
              `
              : `
                <div class="empty-state">
                  <span class="empty-state__icon">${icon("check", 22)}</span>
                  <h3>Tutto in ordine</h3>
                  <p>Non ci sono scadenze arretrate da controllare.</p>
                </div>
              `
          }
        </article>

        <article class="card">
          <header class="card-header">
            <div>
              <h2>Composizione dei corsi</h2>
              <p>Allievi iscritti per percorso</p>
            </div>
            <a class="btn btn--ghost btn--sm" href="#/admin/courses">Gestisci</a>
          </header>
          <div class="grid" style="gap:15px">
            ${state.data.courses
              .filter((course) => course.is_active !== false)
              .map((course) => {
                const count = state.data.enrollments.filter(
                  (item) =>
                    item.course_id === course.id && item.is_active !== false,
                ).length;
                const capacity = Number(course.capacity || 6);
                const percentage = Math.min(
                  100,
                  Math.round((count / Math.max(capacity, 1)) * 100),
                );
                return `
                  <div class="progress-block">
                    <div class="progress-heading">
                      <strong>${escapeHTML(course.name)}</strong>
                      <span>${count} iscritti</span>
                    </div>
                    <div class="progress"><div class="progress__bar" style="width:${percentage}%;background:${safeColor(course.color)}"></div></div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </article>

        <article class="card">
          <header class="card-header">
            <div>
              <h2>Ultimi incassi</h2>
              <p>Movimenti registrati di recente</p>
            </div>
          </header>
          ${
            recentPaid.length
              ? `
                <div class="activity-list">
                  ${recentPaid
                    .map((payment) => {
                      const invoice = state.data.invoices.find(
                        (item) => item.id === payment.invoice_id,
                      );
                      const student = studentForInvoice(invoice);
                      const netAmount =
                        Number(payment.amount_cents || 0) -
                        Number(payment.refunded_cents || 0);
                      return `
                        <div class="activity-item">
                          <span class="activity-icon">${icon("receipt", 16)}</span>
                          <span class="activity-copy">
                            <strong>${escapeHTML(formatMoney(netAmount, payment.currency))} · ${escapeHTML(fullName(student))}</strong>
                            <span>Incassato il ${escapeHTML(formatDate(payment.paid_at || payment.created_at))} via ${escapeHTML(paymentMethodLabel(payment.method))}</span>
                          </span>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
              `
              : `<div class="empty-state"><p>Nessun incasso registrato.</p></div>`
          }
        </article>
      </section>
    `;
  }

  function attendanceDateStrip() {
    const center = toLocalDate(state.attendanceDate);
    const start = addDays(center, -3);
    return `
      <div class="date-strip" aria-label="Scegli il giorno">
        ${Array.from({ length: 7 }, (_, index) => {
          const date = addDays(start, index);
          const key = dateKey(date);
          return `
            <button class="date-pill${key === state.attendanceDate ? " is-active" : ""}" type="button" data-action="select-attendance-date" data-date="${key}">
              <span>${escapeHTML(formatDate(date, { weekday: "short" }))}</span>
              <strong>${date.getDate()}</strong>
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderRegister(lesson) {
    const course = courseForLesson(lesson);
    const students = studentsForLesson(lesson);
    const rows = students.map((student) => {
      const attendance = attendanceFor(lesson.id, student.id);
      const current = attendance?.status || "";
      return `
        <div class="attendance-row">
          <div class="person-cell">
            <span class="avatar avatar--soft">${escapeHTML(initials(fullName(student)))}</span>
            <span class="person-cell__copy">
              <strong>${escapeHTML(fullName(student))}</strong>
              <span>${escapeHTML(familyForStudent(student)?.display_name || "")}</span>
            </span>
          </div>
          <div class="attendance-options" role="group" aria-label="Presenza di ${escapeHTML(fullName(student))}">
            <button class="attendance-option${current === "present" ? " is-present" : ""}" type="button" data-action="mark-attendance" data-lesson-id="${escapeHTML(lesson.id)}" data-student-id="${escapeHTML(student.id)}" data-status="present" aria-label="Segna ${escapeHTML(fullName(student))} presente" aria-pressed="${current === "present"}">
              ${icon("checkSimple", 15)} <span>Presente</span>
            </button>
            <button class="attendance-option${current === "absent_excused" ? " is-excused" : ""}" type="button" data-action="mark-attendance" data-lesson-id="${escapeHTML(lesson.id)}" data-student-id="${escapeHTML(student.id)}" data-status="absent_excused" aria-label="Segna assenza avvisata per ${escapeHTML(fullName(student))}" aria-pressed="${current === "absent_excused"}">
              ${icon("clock", 15)} <span>Avvisata</span>
            </button>
            <button class="attendance-option${current === "absent_unexcused" ? " is-unexcused" : ""}" type="button" data-action="mark-attendance" data-lesson-id="${escapeHTML(lesson.id)}" data-student-id="${escapeHTML(student.id)}" data-status="absent_unexcused" aria-label="Segna assenza non avvisata per ${escapeHTML(fullName(student))}" aria-pressed="${current === "absent_unexcused"}">
              ${icon("x", 15)} <span>Non avvisata</span>
            </button>
          </div>
        </div>
      `;
    });
    const marked = students.filter((student) =>
      attendanceFor(lesson.id, student.id),
    ).length;
    const present = students.filter(
      (student) =>
        attendanceFor(lesson.id, student.id)?.status === "present",
    ).length;

    return `
      <article class="lesson-register">
        <header class="lesson-register__header">
          <div class="lesson-register__title">
            <span class="course-color" style="background:${safeColor(course?.color)}"></span>
            <span>
              <strong>${escapeHTML(lesson.title || course?.name || "Lezione")}</strong>
              <span>${escapeHTML(formatTime(lesson.starts_at))}–${escapeHTML(formatTime(lesson.ends_at))} · ${escapeHTML(lesson.location || course?.location || "Studio")}</span>
            </span>
          </div>
          ${statusBadge("lessonStatus", lesson.status)}
        </header>
        ${
          rows.length
            ? rows.join("")
            : `<div class="empty-state"><span class="empty-state__icon">${icon("users", 22)}</span><h3>Nessun allievo iscritto</h3><p>Controlla le iscrizioni associate a questo corso.</p></div>`
        }
        ${
          rows.length
            ? `<footer class="attendance-summary"><span>${marked} di ${students.length} registrati</span><strong>${present} presenti</strong></footer>`
            : ""
        }
      </article>
    `;
  }

  function renderAdminAttendance() {
    const closure = schoolClosureForDate(state.attendanceDate);
    const lessonsOnDate = state.data.lessons
      .filter(
        (item) =>
          dateKey(item.starts_at) === state.attendanceDate &&
          !String(item.status).startsWith("cancelled"),
      )
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const lessons = closure
      ? []
      : lessonsOnDate.filter((lesson) => !lessonIsOnSchoolClosure(lesson));
    const isToday = state.attendanceDate === todayKey();

    return `
      ${pageHeader(
        "Registro",
        isToday
          ? "Presenze di oggi"
          : `Presenze del ${formatDate(state.attendanceDate, { day: "numeric", month: "long" })}`,
        "Un tocco per registrare presenza o assenza. Il recupero resta sempre sotto il tuo controllo.",
        `<label><span class="sr-only">Vai alla data</span><input class="input" id="attendance-date-picker" type="date" value="${escapeHTML(state.attendanceDate)}" aria-label="Vai alla data" style="width:145px" /></label><button class="btn btn--secondary" type="button" data-action="attendance-today">${icon("calendar", 16)} Oggi</button>${closure ? `<button class="btn btn--secondary" type="button" data-action="delete-school-closure" data-closure-id="${escapeHTML(closure.id)}">Riapri data</button>` : `<button class="btn btn--secondary" type="button" data-action="open-school-closure-modal" data-date="${escapeHTML(state.attendanceDate)}">Segna chiusura</button><button class="btn btn--primary" type="button" data-action="open-lesson-modal" data-date="${escapeHTML(state.attendanceDate)}">${icon("plus", 16)} Aggiungi lezione</button>`}`,
      )}
      ${attendanceDateStrip()}
      <div>
        ${
          closure
            ? `
              <article class="card">
                <div class="closure-callout">
                  ${icon("calendar", 18)}
                  <p><strong>${escapeHTML(SCHOOL_CLOSURE_TITLE)}</strong>${schoolClosureDescription(closure) ? ` · ${escapeHTML(schoolClosureDescription(closure))}` : ""}. Non ci sono presenze da registrare.${lessonsOnDate.length ? ` Sono presenti ${lessonsOnDate.length} ${lessonsOnDate.length === 1 ? "appuntamento manuale da verificare" : "appuntamenti manuali da verificare"}.` : ""}</p>
                </div>
              </article>
            `
            : lessons.length
            ? lessons.map(renderRegister).join("")
            : `
              <article class="card">
                <div class="empty-state">
                  <span class="empty-state__icon">${icon("music", 24)}</span>
                  <h3>Nessuna lezione in questo giorno</h3>
                  <p>Puoi scegliere un’altra data oppure aggiungere una lezione o un recupero.</p>
                  <button class="btn btn--primary btn--sm" type="button" data-action="open-lesson-modal" data-date="${escapeHTML(state.attendanceDate)}">${icon("plus", 15)} Nuova lezione</button>
                </div>
              </article>
            `
        }
      </div>
    `;
  }

  function studentBalance(studentId) {
    return state.data.invoices
      .filter(
        (item) =>
          item.student_id === studentId &&
          ["pending", "overdue", "partially_paid", "processing"].includes(
            invoiceEffectiveStatus(item),
          ),
      )
      .reduce((sum, item) => sum + invoiceOutstandingCents(item), 0);
  }

  function filteredStudents() {
    const query = state.filters.studentSearch.trim().toLowerCase();
    return state.data.students
      .filter((student) => {
        if (student.is_active === false) return false;
        const course = courseForStudent(student.id);
        const family = familyForStudent(student);
        const haystack = `${fullName(student)} ${student.fiscal_code || ""} ${student.residence_address || ""} ${family?.guardian_name || ""} ${familyAccessEmails(family).join(" ")}`.toLowerCase();
        const matchesSearch = !query || haystack.includes(query);
        const matchesCourse =
          state.filters.studentCourse === "all" ||
          course?.id === state.filters.studentCourse;
        return matchesSearch && matchesCourse;
      })
      .sort((a, b) => fullName(a).localeCompare(fullName(b), "it"));
  }

  function renderStudentMobileRow(student) {
    const course = courseForStudent(student.id);
    const enrollment = enrollmentForStudent(student.id);
    const family = familyForStudent(student);
    return `
      <article class="mobile-row">
        <div class="mobile-row__top">
          <div class="person-cell">
            <span class="avatar avatar--aqua">${escapeHTML(initials(fullName(student)))}</span>
            <span class="person-cell__copy">
              <strong>${escapeHTML(fullName(student))}</strong>
              <span>${escapeHTML(family?.guardian_name || family?.display_name || "")}</span>
            </span>
          </div>
          <div class="row-actions">
            <button class="row-action" type="button" data-action="edit-student" data-student-id="${escapeHTML(student.id)}" aria-label="Modifica">${icon("edit", 16)}</button>
            <button class="row-action" type="button" data-action="delete-student" data-student-id="${escapeHTML(student.id)}" aria-label="Elimina allievo">${icon("trash", 16)}</button>
          </div>
        </div>
        <div class="mobile-row__meta">
          <div><span>Corso</span><strong>${escapeHTML(course?.name || "—")}</strong></div>
          <div><span>Piano</span><strong>${escapeHTML(LABELS.plan[enrollment?.plan_type] || "—")}</strong></div>
          <div><span>Frequenza</span><strong>${studentAttendanceStats(student.id).rate}%</strong></div>
          <div><span>Saldo</span><strong>${escapeHTML(formatMoney(studentBalance(student.id)))}</strong></div>
        </div>
      </article>
    `;
  }

  function renderAdminStudents() {
    const students = filteredStudents();
    return `
      ${pageHeader(
        "Anagrafica",
        "Allievi e famiglie",
        `${state.data.students.filter((item) => item.is_active !== false).length} allievi attivi nei percorsi di Quarto MoVimento.`,
        `<button class="btn btn--primary" type="button" data-action="open-student-modal">${icon("plus", 17)} Nuovo allievo</button>`,
      )}
      <div class="toolbar">
        <div class="toolbar__left">
          <div class="search-box">
            ${icon("search", 17)}
            <input class="input" id="student-search" type="search" placeholder="Cerca allievo, genitore o e-mail…" value="${escapeHTML(state.filters.studentSearch)}" />
          </div>
          <select class="select filter-select" id="student-course-filter" aria-label="Filtra per corso">
            <option value="all">Tutti i corsi</option>
            ${state.data.courses
              .filter((course) => course.is_active !== false)
              .map(
                (course) =>
                  `<option value="${escapeHTML(course.id)}"${state.filters.studentCourse === course.id ? " selected" : ""}>${escapeHTML(course.name)}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="toolbar__right">
          <span class="muted" style="font-size:11px">${students.length} risultati</span>
        </div>
      </div>

      <div class="table-wrap desktop-table">
        <table class="data-table">
          <thead>
            <tr>
              <th>Allievo</th>
              <th>Corso</th>
              <th>Piano</th>
              <th>Frequenza</th>
              <th>Saldo aperto</th>
              <th><span class="sr-only">Azioni</span></th>
            </tr>
          </thead>
          <tbody>
            ${
              students.length
                ? students
                    .map((student) => {
                      const course = courseForStudent(student.id);
                      const enrollment = enrollmentForStudent(student.id);
                      const family = familyForStudent(student);
                      const stats = studentAttendanceStats(student.id);
                      const balance = studentBalance(student.id);
                      return `
                        <tr>
                          <td>
                            <div class="person-cell">
                              <span class="avatar avatar--aqua">${escapeHTML(initials(fullName(student)))}</span>
                              <span class="person-cell__copy">
                                <strong>${escapeHTML(fullName(student))}</strong>
                                <span>${escapeHTML(family?.guardian_name || family?.display_name || "")} · ${escapeHTML(family?.email || "")}</span>
                              </span>
                            </div>
                          </td>
                          <td><span class="dot" style="background:${safeColor(course?.color)};margin-right:7px"></span>${escapeHTML(course?.name || "—")}</td>
                          <td><span class="badge badge--plain">${escapeHTML(LABELS.plan[enrollment?.plan_type] || "—")}</span></td>
                          <td><strong>${stats.rate}%</strong> <span class="subtle">(${stats.present}/${stats.total})</span></td>
                          <td><span class="money" style="color:${balance ? "var(--danger)" : "var(--success)"}">${escapeHTML(formatMoney(balance))}</span></td>
                          <td>
                            <div class="row-actions">
                              <button class="row-action" type="button" data-action="view-student" data-student-id="${escapeHTML(student.id)}" aria-label="Apri scheda">${icon("eye", 16)}</button>
                              <button class="row-action" type="button" data-action="edit-student" data-student-id="${escapeHTML(student.id)}" aria-label="Modifica">${icon("edit", 16)}</button>
                              <button class="row-action" type="button" data-action="delete-student" data-student-id="${escapeHTML(student.id)}" aria-label="Elimina allievo">${icon("trash", 16)}</button>
                            </div>
                          </td>
                        </tr>
                      `;
                    })
                    .join("")
                : `<tr><td colspan="6"><div class="empty-state"><h3>Nessun risultato</h3><p>Prova a cambiare ricerca o filtro.</p></div></td></tr>`
            }
          </tbody>
        </table>
      </div>
      <div class="mobile-list">
        ${students.length ? students.map(renderStudentMobileRow).join("") : `<div class="empty-state card"><h3>Nessun risultato</h3><p>Prova a cambiare ricerca o filtro.</p></div>`}
      </div>
    `;
  }

  function calendarGridDates(month) {
    const first = startOfMonth(month);
    const weekday = first.getDay() || 7;
    const gridStart = addDays(first, -(weekday - 1));
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }

  function renderAdminCalendar() {
  const dates = calendarGridDates(state.calendarMonth);

  const selectedClosure = schoolClosureForDate(
    state.calendarSelectedDate,
  );

  const selectedLessons = state.data.lessons
    .filter(
      (item) =>
        dateKey(item.starts_at) === state.calendarSelectedDate &&
        !lessonIsOnSchoolClosure(item),
    )
    .sort(
      (a, b) =>
        new Date(a.starts_at) - new Date(b.starts_at),
    );

  const selected = toLocalDate(
    state.calendarSelectedDate,
  );

  const selectedClosureIsAutomatic = Boolean(
    selectedClosure?.automatic ||
      selectedClosure?.is_automatic,
  );

  return `
    ${pageHeader(
      "Programmazione",
      "Calendario lezioni",
      "Le lezioni ordinarie seguono i corsi; qui aggiungi date singole, prove, eventi e recuperi.",
      `<button class="btn btn--secondary" type="button" data-action="open-course-modal">${icon("plus", 16)} Nuovo corso</button><button class="btn btn--primary" type="button" data-action="open-lesson-modal">${icon("plus", 16)} Nuova lezione</button>`,
    )}

    <div class="calendar-layout">

      <section class="card calendar-card">

        <div class="calendar-toolbar">

          <h2>${escapeHTML(
            formatMonth(state.calendarMonth),
          )}</h2>

          <div class="calendar-toolbar__nav">

            <button
              class="btn btn--secondary btn--icon btn--sm"
              type="button"
              data-action="calendar-prev"
              aria-label="Mese precedente"
            >
              ${icon("chevronLeft", 16)}
            </button>

            <button
              class="btn btn--secondary btn--sm"
              type="button"
              data-action="calendar-today"
            >
              Oggi
            </button>

            <button
              class="btn btn--secondary btn--icon btn--sm"
              type="button"
              data-action="calendar-next"
              aria-label="Mese successivo"
            >
              ${icon("chevronRight", 16)}
            </button>

          </div>
        </div>

        <div class="calendar-grid">

          ${[
            "Lun",
            "Mar",
            "Mer",
            "Gio",
            "Ven",
            "Sab",
            "Dom",
          ]
            .map(
              (day) =>
                `<div class="calendar-weekday">${day}</div>`,
            )
            .join("")}

          ${dates
            .map((date) => {
              const key = dateKey(date);

              const closure =
                schoolClosureForDate(key);

              /*
               * IMPORTANTISSIMO:
               * se il giorno è chiuso, nessuna lezione
               * deve essere mostrata nel calendario.
               */
              const dayLessons = state.data.lessons
                .filter(
                  (item) =>
                    dateKey(item.starts_at) === key &&
                    !lessonIsOnSchoolClosure(item),
                )
                .sort(
                  (a, b) =>
                    new Date(a.starts_at) -
                    new Date(b.starts_at),
                );

              const outside =
                date.getMonth() !==
                state.calendarMonth.getMonth();

              /*
               * In un giorno di chiusura mostriamo
               * soltanto la chiusura.
               */
              const visibleLessonCount =
                closure ? 0 : 3;

              const hiddenEntries =
                closure
                  ? 0
                  : Math.max(
                      0,
                      dayLessons.length - 3,
                    );

              return `
                <div
                  class="calendar-day${outside ? " is-outside" : ""}${key === todayKey() ? " is-today" : ""}${closure ? " is-closure" : ""}"
                  data-action="calendar-select-day"
                  data-date="${key}"
                  role="button"
                  tabindex="0"
                  aria-label="Seleziona ${escapeHTML(
                    formatDate(date, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }),
                  )}${
                    closure
                      ? `, ${escapeHTML(
                          SCHOOL_CLOSURE_TITLE,
                        )}`
                      : ""
                  }"
                >

                  <span class="calendar-day__number">
                    ${date.getDate()}
                  </span>

                  ${
                    closure
                      ? `
                        <button
                          class="calendar-event is-closure"
                          type="button"
                          data-action="open-school-closure-modal"
                          data-date="${escapeHTML(key)}"
                          aria-label="${escapeHTML(
                            `${SCHOOL_CLOSURE_TITLE}, ${formatDate(
                              date,
                              {
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                              },
                            )}`,
                          )}"
                        >
                          ${escapeHTML(
                            SCHOOL_CLOSURE_TITLE,
                          )}
                        </button>
                      `
                      : ""
                  }

                  ${dayLessons
                    .slice(
                      0,
                      visibleLessonCount,
                    )
                    .map((lesson) => {
                      const course =
                        courseForLesson(lesson);

                      const isMakeup = [
                        "makeup",
                        "recovery",
                      ].includes(
                        lesson.lesson_type,
                      );

                      return `
                        <button
                          class="calendar-event${
                            isMakeup
                              ? " is-makeup"
                              : ""
                          }"
                          style="border-left-color:${safeColor(
                            course?.color,
                          )}"
                          type="button"
                          data-action="view-lesson"
                          data-lesson-id="${escapeHTML(
                            lesson.id,
                          )}"
                        >
                          ${escapeHTML(
                            formatTime(
                              lesson.starts_at,
                            ),
                          )}
                          ${escapeHTML(
                            lesson.title ||
                              course?.name ||
                              "Lezione",
                          )}
                        </button>
                      `;
                    })
                    .join("")}

                  ${
                    hiddenEntries
                      ? `
                        <span class="calendar-more">
                          +${hiddenEntries}
                          ${
                            hiddenEntries === 1
                              ? "altro"
                              : "altri"
                          }
                        </span>
                      `
                      : ""
                  }

                </div>
              `;
            })
            .join("")}

        </div>
      </section>

      <aside class="card agenda-card">

        <div class="agenda-date">

          <span class="agenda-date__day">
            <span>
              ${escapeHTML(
                formatDate(selected, {
                  weekday: "short",
                }),
              )}
            </span>

            <strong>
              ${selected.getDate()}
            </strong>
          </span>

          <span class="agenda-date__copy">

            <strong>
              ${escapeHTML(
                formatDate(selected, {
                  month: "long",
                  year: "numeric",
                }),
              )}
            </strong>

            <span>
              ${
                selectedClosure
                  ? SCHOOL_CLOSURE_TITLE
                  : `${selectedLessons.length} ${
                      selectedLessons.length === 1
                        ? "appuntamento"
                        : "appuntamenti"
                    }`
              }
            </span>

          </span>

        </div>

        ${
          selectedClosure
            ? `
              <div
                class="agenda-item is-closure"
                style="width:100%;background:transparent;text-align:left"
              >
                <strong>
                  ${escapeHTML(
                    SCHOOL_CLOSURE_TITLE,
                  )}
                </strong>

                <span>
                  ${escapeHTML(
                    schoolClosureDescription(
                      selectedClosure,
                    ) ||
                      "Lo studio resta chiuso per l’intera giornata.",
                  )}
                </span>
              </div>
            `
            : selectedLessons.length
              ? selectedLessons
                  .map((lesson) => {
                    const course =
                      courseForLesson(lesson);

                    return `
                      <button
                        class="agenda-item"
                        type="button"
                        data-action="view-lesson"
                        data-lesson-id="${escapeHTML(
                          lesson.id,
                        )}"
                        style="width:100%;background:transparent;text-align:left;cursor:pointer"
                      >
                        <strong>
                          ${escapeHTML(
                            formatTime(
                              lesson.starts_at,
                            ),
                          )}
                          ·
                          ${escapeHTML(
                            lesson.title ||
                              course?.name ||
                              "Lezione",
                          )}
                        </strong>

                        <span>
                          ${escapeHTML(
                            LABELS.lessonType[
                              lesson.lesson_type
                            ] ||
                              lesson.lesson_type,
                          )}
                          ·
                          ${
                            studentsForLesson(
                              lesson,
                            ).length
                          }
                          allievi
                        </span>

                      </button>
                    `;
                  })
                  .join("")
              : `
                <div
                  class="empty-state"
                  style="min-height:150px;padding:20px 0"
                >
                  <span class="empty-state__icon">
                    ${icon("calendar", 21)}
                  </span>

                  <h3>Giornata libera</h3>

                  <p>
                    Nessuna lezione in questa data.
                  </p>
                </div>
              `
        }

        ${
          selectedClosure
            ? selectedClosureIsAutomatic
              ? `
                <div
                  class="info-callout"
                  style="margin-top:12px"
                >
                  ${icon("info", 16)}
                  <p>
                    Chiusura prevista dal regolamento
                    scolastico.
                  </p>
                </div>
              `
              : `
                <button
                  class="btn btn--secondary btn--sm"
                  style="width:100%;margin-top:12px"
                  type="button"
                  data-action="delete-school-closure"
                  data-closure-id="${escapeHTML(
                    selectedClosure.id,
                  )}"
                >
                  Riapri questa data
                </button>
              `
            : `
              <button
                class="btn btn--secondary btn--sm"
                style="width:100%;margin-top:12px"
                type="button"
                data-action="open-school-closure-modal"
                data-date="${escapeHTML(
                  state.calendarSelectedDate,
                )}"
              >
                ${icon("calendar", 14)}
                Segna chiusura
              </button>

              <button
                class="btn btn--secondary btn--sm"
                style="width:100%;margin-top:8px"
                type="button"
                data-action="open-lesson-modal"
                data-date="${escapeHTML(
                  state.calendarSelectedDate,
                )}"
              >
                ${icon("plus", 14)}
                Aggiungi qui
              </button>
            `
        }

      </aside>

    </div>
  `;
}

  function filteredInvoices() {
    const query = state.filters.paymentSearch.trim().toLowerCase();
    return state.data.invoices
      .filter((invoice) => {
        const student = studentForInvoice(invoice);
        const family = state.data.families.find(
          (item) => item.id === invoice.family_id,
        );
        const haystack =
          `${invoice.number} ${invoice.title} ${fullName(student)} ${family?.display_name || ""}`.toLowerCase();
        const status = invoiceEffectiveStatus(invoice);
        const paymentStatus = invoicePaymentStatus(invoice);
        return (
          (!query || haystack.includes(query)) &&
          ((state.filters.paymentStatus === "all" && status !== "void") ||
            paymentStatus === state.filters.paymentStatus)
        );
      })
      .sort((a, b) => String(b.due_date).localeCompare(String(a.due_date)));
  }

  function renderAdminMakeupRow(credit) {
    const student = state.data.students.find(
      (item) => item.id === credit.student_id,
    );
    const source = state.data.lessons.find(
      (item) => item.id === credit.source_lesson_id,
    );
    const target = state.data.lessons.find(
      (item) => item.id === credit.used_lesson_id,
    );
    const status = makeupEffectiveStatus(credit);
    return `
      <div class="makeup-item">
        <span class="makeup-icon">${icon("repeat", 18)}</span>
        <span class="makeup-copy">
          <strong>${escapeHTML(fullName(student))}</strong>
          <span>
            ${source ? `Assenza del ${escapeHTML(formatDate(source.starts_at))}` : "Lezione di origine non disponibile"}
            ${target ? ` · assegnato al ${escapeHTML(formatDate(target.starts_at))} alle ${escapeHTML(formatTime(target.starts_at))}` : ""}
            ${credit.expires_on ? ` · scade ${escapeHTML(formatDate(credit.expires_on))}` : ""}
          </span>
          ${credit.reason ? `<span>${escapeHTML(credit.reason)}</span>` : ""}
        </span>
        <span style="display:flex;align-items:flex-end;flex-direction:column;gap:7px">
          ${statusBadge("makeup", status)}
          ${status === "available" ? `<button class="btn btn--primary btn--sm" type="button" data-action="assign-makeup" data-credit-id="${escapeHTML(credit.id)}">Assegna</button>` : ""}
        </span>
      </div>
    `;
  }

  function renderAdminMakeups() {
    const credits = [...state.data.makeupCredits].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
    );
    const available = credits.filter(
      (item) => makeupEffectiveStatus(item) === "available",
    );
    const scheduled = credits.filter((item) =>
      ["proposed", "scheduled"].includes(makeupEffectiveStatus(item)),
    );
    const history = credits.filter((item) =>
      ["used", "expired", "not_eligible", "cancelled"].includes(
        makeupEffectiveStatus(item),
      ),
    );
    const futureSessions = state.data.lessons.filter(
      (lesson) =>
        ["makeup", "recovery"].includes(lesson.lesson_type) &&
        lesson.status === "scheduled" &&
        new Date(lesson.starts_at) > new Date() &&
        !lessonIsOnSchoolClosure(lesson),
    );
    return `
      ${pageHeader(
        "Organizzazione",
        "Recuperi",
        "Assegna i crediti maturati a una sessione compatibile.",
        `<button class="btn btn--primary" type="button" data-action="open-lesson-modal" data-lesson-type="makeup">${icon("plus", 16)} Crea sessione di recupero</button>`,
      )}
      <section class="grid grid--stats">
        ${statCard("Da assegnare", available.length, "Crediti disponibili", "repeat")}
        ${statCard("Programmati", scheduled.length, "Recuperi già concordati", "calendar")}
        ${statCard("Sessioni future", futureSessions.length, "Date disponibili a calendario", "music")}
        ${statCard("Storico", history.length, "Utilizzati, scaduti o non previsti", "check")}
      </section>
      <section class="grid grid--family" style="margin-top:22px">
        <article class="card">
          <header class="card-header">
            <div><h2>Crediti da programmare</h2><p>La compatibilità di corso, data e scadenza viene verificata anche dal database.</p></div>
          </header>
          ${
            available.length
              ? `<div class="makeup-list">${available.map(renderAdminMakeupRow).join("")}</div>`
              : `<div class="empty-state"><span class="empty-state__icon">${icon("check", 22)}</span><h3>Nessun recupero da assegnare</h3><p>Tutti i crediti attivi sono già programmati.</p></div>`
          }
        </article>
        <article class="card">
          <header class="card-header">
            <div><h2>Recuperi programmati</h2><p>Proposte e assegnazioni future.</p></div>
          </header>
          ${
            scheduled.length
              ? `<div class="makeup-list">${scheduled.map(renderAdminMakeupRow).join("")}</div>`
              : `<div class="empty-state"><p>Nessun recupero programmato.</p></div>`
          }
        </article>
      </section>
      ${
        history.length
          ? `<section class="card" style="margin-top:22px"><header class="card-header"><div><h2>Storico recuperi</h2><p>Crediti conclusi o non utilizzabili.</p></div></header><div class="makeup-list">${history.map(renderAdminMakeupRow).join("")}</div></section>`
          : ""
      }
    `;
  }

  function renderInvoiceMobileRow(invoice) {
    const student = studentForInvoice(invoice);
    const status = invoiceEffectiveStatus(invoice);
    const reminder = paymentReminderForInvoice(invoice.id);
    const canSendReminder = canSendPaymentReminder(invoice);
    return `
      <article class="mobile-row">
        <div class="mobile-row__top">
          <div class="person-cell">
            <span class="avatar avatar--soft">${escapeHTML(initials(fullName(student)))}</span>
            <span class="person-cell__copy">
              <strong>${escapeHTML(fullName(student))}</strong>
              <span>${escapeHTML(invoice.title)}</span>
            </span>
          </div>
          <div class="row-actions">
            ${statusBadge("invoice", invoicePaymentStatus(invoice))}
            <button class="row-action" type="button" data-action="view-invoice" data-invoice-id="${escapeHTML(invoice.id)}" aria-label="Dettagli">${icon("eye", 16)}</button>
            ${invoiceCanBeVoided(invoice) ? `<button class="row-action" type="button" data-action="open-void-invoice" data-invoice-id="${escapeHTML(invoice.id)}" aria-label="Elimina scadenza">${icon("trash", 16)}</button>` : ""}
          </div>
        </div>
        <div class="mobile-row__meta">
          <div><span>Da saldare</span><strong>${escapeHTML(formatMoney(invoiceOutstandingCents(invoice), invoice.currency))}</strong></div>
          <div><span>Scadenza</span><strong>${escapeHTML(formatDate(invoice.due_date))}</strong></div>
          <div><span>Numero fattura</span><strong>${escapeHTML(invoice.number)}</strong></div>
          <div><span>Azione</span>${status === "void" ? "<strong>Annullata</strong>" : !["paid", "processing"].includes(status) ? `<button class="copy-button" type="button" data-action="mark-invoice-paid" data-invoice-id="${escapeHTML(invoice.id)}">Segna pagato</button>` : status === "processing" ? "<strong>In elaborazione</strong>" : `<strong>${escapeHTML(paymentMethodLabel(invoice.payment_method))}</strong>`}</div>
          ${reminder ? `<div><span>Promemoria</span><strong>Inviato il ${escapeHTML(formatDate(reminder.sent_at || reminder.created_at))}</strong></div>` : canSendReminder ? `<div><span>Promemoria</span><button class="copy-button" type="button" data-action="open-payment-reminder" data-invoice-id="${escapeHTML(invoice.id)}">Invia notifica</button></div>` : ""}
        </div>
      </article>
    `;
  }

  function renderAdminPayments() {
    const invoices = filteredInvoices();
    const paidPayments = (state.data.payments || []).filter(
      (payment) =>
        ["completed", "partially_refunded", "refunded"].includes(
          payment.status,
        ) &&
        Number(payment.amount_cents || 0) -
          Number(payment.refunded_cents || 0) >
          0,
    );
    const paidTotal = paidPayments.reduce((sum, payment) => {
      return (
        sum +
        Math.max(
          0,
          Number(payment.amount_cents || 0) -
            Number(payment.refunded_cents || 0),
        )
      );
    }, 0);
    const pending = state.data.invoices.filter((item) =>
      ["pending", "partially_paid"].includes(invoiceEffectiveStatus(item)),
    );
    const overdue = state.data.invoices.filter(
      (item) => invoiceEffectiveStatus(item) === "overdue",
    );
    const processing = state.data.invoices.filter(
      (item) => invoiceEffectiveStatus(item) === "processing",
    );
    const outstanding = [...pending, ...overdue, ...processing].reduce(
      (sum, item) => sum + invoiceOutstandingCents(item),
      0,
    );
    const remindersToSend = state.data.invoices.filter(
      canSendPaymentReminder,
    );

    return `
      ${pageHeader(
        "Rendicontazione",
        "Pagamenti",
        "Controlla scadenze e incassi registrati.",
        `<button class="btn btn--primary" type="button" data-action="open-invoice-modal">${icon("plus", 17)} Nuova scadenza</button>`,
      )}
      <section class="grid grid--stats">
        ${statCard("Incassato", formatMoney(paidTotal), `${paidPayments.length} pagamenti registrati`, "wallet")}
        ${statCard("Da incassare", formatMoney(outstanding), `${pending.length + overdue.length + processing.length} scadenze aperte`, "receipt")}
        ${statCard("Scaduto", formatMoney(overdue.reduce((sum, item) => sum + invoiceOutstandingCents(item), 0)), `${overdue.length} posizioni da verificare`, "alert")}
        ${statCard("Da sollecitare", remindersToSend.length, "Insoluti da almeno 5 giorni", "bell")}
      </section>

      <section style="margin-top:22px">
        <div class="toolbar">
          <div class="toolbar__left">
            <div class="search-box">
              ${icon("search", 17)}
              <input class="input" id="payment-search" type="search" placeholder="Cerca allievo, numero o voce…" value="${escapeHTML(state.filters.paymentSearch)}" />
            </div>
            <select class="select filter-select" id="payment-status-filter" aria-label="Filtra per stato">
              <option value="all">Tutti gli stati</option>
              ${["pending", "paid"]
                .map(
                  (status) =>
                    `<option value="${status}"${state.filters.paymentStatus === status ? " selected" : ""}>${escapeHTML(LABELS.invoice[status])}</option>`,
                )
                .join("")}
            </select>
          </div>
          <div class="toolbar__right">
            <span class="muted" style="font-size:11px">${invoices.length} movimenti</span>
          </div>
        </div>

        <div class="table-wrap desktop-table">
          <table class="data-table">
            <thead>
              <tr>
                <th>Allievo</th>
                <th>Voce</th>
                <th>Scadenza</th>
                <th>Importo</th>
                <th>Stato</th>
                <th><span class="sr-only">Azioni</span></th>
              </tr>
            </thead>
            <tbody>
              ${
                invoices.length
                  ? invoices
                      .map((invoice) => {
                        const student = studentForInvoice(invoice);
                        const status = invoiceEffectiveStatus(invoice);
                        const reminder = paymentReminderForInvoice(invoice.id);
                        const canSendReminder = canSendPaymentReminder(invoice);
                        return `
                          <tr>
                            <td>
                              <div class="person-cell">
                                <span class="avatar avatar--soft">${escapeHTML(initials(fullName(student)))}</span>
                                <span class="person-cell__copy">
                                  <strong>${escapeHTML(fullName(student))}</strong>
                                  <span>${escapeHTML(invoice.number)}</span>
                                </span>
                              </div>
                            </td>
                            <td><strong>${escapeHTML(invoice.title)}</strong><br><span class="subtle">${escapeHTML(invoice.description || "")}</span></td>
                            <td>${escapeHTML(formatDate(invoice.due_date))}</td>
                            <td><span class="money">${escapeHTML(formatMoney(invoiceOutstandingCents(invoice), invoice.currency))}</span>${invoicePaidCents(invoice) > 0 ? `<br><span class="subtle">su ${escapeHTML(formatMoney(invoice.total_cents, invoice.currency))}</span>` : ""}</td>
                            <td>${statusBadge("invoice", invoicePaymentStatus(invoice))}</td>
                            <td>
                              <div class="row-actions">
                                <button class="row-action" type="button" data-action="view-invoice" data-invoice-id="${escapeHTML(invoice.id)}" aria-label="Dettagli">${icon("eye", 16)}</button>
                                ${canSendReminder ? `<button class="row-action" type="button" data-action="open-payment-reminder" data-invoice-id="${escapeHTML(invoice.id)}" title="Invia notifica alla famiglia" aria-label="Invia promemoria di pagamento">${icon("bell", 16)}</button>` : ""}
                                ${reminder ? `<button class="row-action" type="button" disabled title="Promemoria inviato il ${escapeHTML(formatDate(reminder.sent_at || reminder.created_at))}" aria-label="Promemoria già inviato">${icon("bell", 16)}</button>` : ""}
                                ${
                                  !["paid", "processing", "void"].includes(status)
                                    ? `<button class="row-action" type="button" data-action="mark-invoice-paid" data-invoice-id="${escapeHTML(invoice.id)}" aria-label="Segna come pagato">${icon("checkSimple", 16)}</button>`
                                    : ""
                                }
                                ${invoiceCanBeVoided(invoice) ? `<button class="row-action" type="button" data-action="open-void-invoice" data-invoice-id="${escapeHTML(invoice.id)}" aria-label="Elimina scadenza">${icon("trash", 16)}</button>` : ""}
                              </div>
                            </td>
                          </tr>
                        `;
                      })
                      .join("")
                  : `<tr><td colspan="6"><div class="empty-state"><h3>Nessun movimento</h3><p>Non ci sono risultati per i filtri selezionati.</p></div></td></tr>`
              }
            </tbody>
          </table>
        </div>
        <div class="mobile-list">
          ${invoices.length ? invoices.map(renderInvoiceMobileRow).join("") : `<div class="empty-state card"><h3>Nessun movimento</h3><p>Non ci sono risultati.</p></div>`}
        </div>
      </section>
    `;
  }

  function renderAdminCourses() {
    const courses = state.data.courses.filter(
      (course) => course.is_active !== false,
    );

    return `
      ${pageHeader(
        "Programmazione",
        "Corsi",
        "Definisci periodo, giorno e orario: il calendario delle lezioni si aggiorna automaticamente.",
        `<button class="btn btn--primary" type="button" data-action="open-course-modal">${icon("plus", 16)} Nuovo corso</button>`,
      )}
      <section class="card">
        <div class="card-header">
          <div>
            <h3>Percorsi attivi</h3>
            <p>Ogni programmazione genera e mantiene collegate le lezioni ordinarie nel calendario.</p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Corso</th><th>Programmazione</th><th>Durata</th><th>Sede</th><th>Iscritti</th><th></th></tr></thead>
            <tbody>
              ${
                courses.length
                  ? courses
                      .map((course) => {
                        const count = state.data.enrollments.filter(
                          (item) =>
                            item.course_id === course.id &&
                            item.is_active !== false,
                        ).length;
                        const schedule = courseScheduleConfigured(course)
                          ? `<strong>${escapeHTML(COURSE_WEEKDAYS[course.weekday] || "—")} · ${escapeHTML(courseTimeRange(course))}</strong><br><span class="subtle">${escapeHTML(formatDate(course.starts_on))}–${escapeHTML(formatDate(course.ends_on))}</span>`
                          : `<span class="badge badge--warning">Da configurare</span>`;
                        return `<tr><td><span class="dot" style="background:${safeColor(course.color)};margin-right:7px"></span><strong>${escapeHTML(course.name)}</strong></td><td>${schedule}</td><td>${escapeHTML(course.duration_minutes)} min</td><td>${escapeHTML(course.location || "—")}</td><td>${count}</td><td><div class="row-actions"><button class="row-action" type="button" data-action="edit-course" data-course-id="${escapeHTML(course.id)}" aria-label="Modifica">${icon("edit", 15)}</button><button class="row-action" type="button" data-action="delete-course" data-course-id="${escapeHTML(course.id)}" aria-label="Elimina corso">${icon("trash", 15)}</button></div></td></tr>`;
                      })
                      .join("")
                  : `<tr><td colspan="6"><div class="empty-state"><h3>Nessun corso attivo</h3><p>Aggiungi il primo corso per creare il calendario.</p></div></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderAdminSettings() {
    const settings = state.data.settings || {};
    const tabs = [
      ["school", "Studio"],
      ["rules", "Anno e recuperi"],
      ["payments", "Pagamenti"],
    ];

    let content = "";
    if (state.settingsTab === "school") {
      content = `
        <form id="settings-school-form">
          <div class="setting-section">
            <h3>Dati dello studio</h3>
            <p>Informazioni generali dello studio.</p>
            <div class="form-grid">
              <div class="field"><label for="school-name">Nome</label><input class="input" id="school-name" name="school_name" value="${escapeHTML(settings.school_name || "Studio Quarto MoVimento")}" required /></div>
              <div class="field"><label for="school-address">Indirizzo</label><input class="input" id="school-address" name="school_address" value="${escapeHTML(settings.school_address || "")}" /></div>
            </div>
          </div>
          <div class="modal__footer" style="margin:22px -21px -21px"><button class="btn btn--primary" type="submit">Salva modifiche</button></div>
        </form>
      `;
    } else if (state.settingsTab === "rules") {
      content = `
        <form id="settings-rules-form">
          <div class="info-callout" style="margin-bottom:18px">
            ${icon("info", 18)}
            <p>Il regolamento pubblico contiene oggi alcune date non allineate. Qui restano configurabili, così il gestionale non applica una regola rigida sbagliata.</p>
          </div>
          <div class="setting-section">
            <h3>Anno didattico</h3>
            <p>Periodo usato per calendario, iscrizioni e scadenza dei recuperi.</p>
            <div class="form-grid">
              <div class="field"><label for="academic-label">Etichetta</label><input class="input" id="academic-label" name="academic_year_label" value="${escapeHTML(settings.academic_year_label || "")}" placeholder="2026/2027" /></div>
              <div class="field"><label for="notice-hours">Preavviso assenza (ore)</label><input class="input" id="notice-hours" name="absence_notice_hours" type="number" min="0" max="168" value="${escapeHTML(settings.absence_notice_hours ?? 24)}" /></div>
              <div class="field"><label for="academic-start">Inizio corsi</label><input class="input" id="academic-start" name="academic_year_start" type="date" value="${escapeHTML(settings.academic_year_start || "")}" /></div>
              <div class="field"><label for="academic-end">Fine corsi</label><input class="input" id="academic-end" name="academic_year_end" type="date" value="${escapeHTML(settings.academic_year_end || "")}" /></div>
              <div class="field"><label for="makeup-deadline">Termine recuperi</label><input class="input" id="makeup-deadline" name="makeup_deadline" type="date" value="${escapeHTML(settings.makeup_deadline || "")}" /></div>
            </div>
          </div>
          <div class="modal__footer" style="margin:22px -21px -21px"><button class="btn btn--primary" type="submit">Salva regole</button></div>
        </form>
      `;
    } else {
      content = `
        <form id="settings-payments-form">
          <div class="setting-section">
            <h3>Bonifico bancario</h3>
            <p>L’IBAN viene letto da Supabase solo dopo l’accesso; non è inserito nel codice pubblico di GitHub Pages.</p>
            <div class="form-grid">
              <div class="field"><label for="bank-holder">Intestatario</label><input class="input" id="bank-holder" name="bank_account_holder" value="${escapeHTML(settings.bank_account_holder || "")}" /></div>
              <div class="field"><label for="bank-iban">IBAN</label><input class="input" id="bank-iban" name="bank_iban" value="${escapeHTML(settings.bank_iban || "")}" autocomplete="off" /></div>
              <div class="field"><label for="bank-bic">BIC/SWIFT</label><input class="input" id="bank-bic" name="bank_bic" value="${escapeHTML(settings.bank_bic || "")}" /></div>
              <div class="field"><label for="bank-reference">Modello causale</label><input class="input" id="bank-reference" name="bank_reference_template" value="${escapeHTML(settings.bank_reference_template || BANK_REFERENCE_TEMPLATE)}" /><p class="field-hint">Usa {nome}, {cognome} e {numero}: la famiglia vedrà la causale già compilata.</p></div>
            </div>
          </div>
          <div class="setting-section">
            <h3>PayPal</h3>
            <p>Il client ID pubblico è ${config.paypalClientId ? "configurato" : "ancora da configurare"}; il secret resta esclusivamente nelle Edge Functions di Supabase.</p>
            ${config.paypalClientId ? statusBadge("invoice", "paid").replace("Pagato", "Configurato") : statusBadge("invoice", "pending").replace("Da pagare", "Da configurare")}
          </div>
          <div class="modal__footer" style="margin:22px -21px -21px"><button class="btn btn--primary" type="submit">Salva dati bancari</button></div>
        </form>
      `;
    }

    return `
      ${pageHeader(
        "Configurazione",
        "Impostazioni",
        "Personalizza studio, regole e modalità di pagamento.",
        "",
      )}
      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Sezioni impostazioni">
          ${tabs
            .map(
              ([id, label]) =>
                `<button class="${state.settingsTab === id ? "is-active" : ""}" type="button" data-action="settings-tab" data-tab="${id}">${escapeHTML(label)}</button>`,
            )
            .join("")}
        </nav>
        <section class="card">${content}</section>
      </div>
    `;
  }

  function familyStudentSwitcher() {
    if (state.data.students.length <= 1) return "";
    return `
      <div class="student-switcher" role="group" aria-label="Scegli allievo">
        ${state.data.students
          .map(
            (student) =>
              `<button class="${student.id === state.selectedStudentId ? "is-active" : ""}" type="button" data-action="select-family-student" data-student-id="${escapeHTML(student.id)}">${escapeHTML(student.first_name)}</button>`,
          )
          .join("")}
      </div>
    `;
  }

  function lessonsForStudent(studentId) {
    const enrollments = enrollmentsForStudent(studentId);
    const assignedLessonIds = new Set(
      state.data.makeupCredits
        .filter(
          (credit) =>
            credit.student_id === studentId &&
            credit.used_lesson_id &&
            ["scheduled", "used"].includes(credit.status),
        )
        .map((credit) => credit.used_lesson_id),
    );
    return state.data.lessons
      .filter((lesson) => {
        if (lessonIsOnSchoolClosure(lesson)) return false;
        if (["makeup", "recovery"].includes(lesson.lesson_type)) {
          return assignedLessonIds.has(lesson.id);
        }
        return enrollments.some(
          (enrollment) =>
            lesson.course_id === enrollment.course_id &&
            (!enrollment.starts_on ||
              dateKey(lesson.starts_at) >= enrollment.starts_on) &&
            (!enrollment.ends_on ||
              dateKey(lesson.starts_at) <= enrollment.ends_on),
        );
      })
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  }

  function familyOpenInvoices() {
    return state.data.invoices
      .filter((invoice) =>
        ["pending", "overdue", "processing", "partially_paid"].includes(
          invoiceEffectiveStatus(invoice),
        ),
      )
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  }

  function renderFamilyPaymentReminders(studentId) {
    const entries = activePaymentReminderEntries(studentId);
    if (!entries.length) return "";
    return `
      <section class="card card--tinted-yellow" style="margin-bottom:18px">
        <header class="card-header">
          <div>
            <h2>Promemoria di pagamento</h2>
            <p>${entries.length === 1 ? "Una quota risulta insoluta da almeno 5 giorni." : `${entries.length} quote risultano insolute da almeno 5 giorni.`}</p>
          </div>
          <span class="stat-card__icon">${icon("bell", 18)}</span>
        </header>
        <div class="payment-list">
          ${entries
            .map(({ reminder, invoice }) => {
              const student = studentForInvoice(invoice);
              const contactUrl = whatsappUrl(
                `Ciao Valeria, vorrei parlarti del promemoria per la fattura ${invoice.number} di ${fullName(student)}.`,
              );
              return `
                <div class="payment-item">
                  <span class="payment-item__copy">
                    <strong>${escapeHTML(invoice.title)}</strong>
                    <span>${escapeHTML(fullName(student))} · fattura ${escapeHTML(invoice.number)} · scaduta il ${escapeHTML(formatDate(invoice.due_date))}</span>
                    <span>Promemoria ricevuto il ${escapeHTML(formatDate(reminder.sent_at || reminder.created_at))}. Se hai già pagato, non effettuare un secondo pagamento: contatta Valeria.</span>
                  </span>
                  <span class="payment-item__amount">
                    <span class="money">${escapeHTML(formatMoney(invoiceOutstandingCents(invoice), invoice.currency))}</span>
                    <span style="display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap">
                      <a class="btn btn--secondary btn--sm" href="${escapeHTML(contactUrl)}" target="_blank" rel="noopener noreferrer">Parlane con Valeria</a>
                      <button class="btn btn--primary btn--sm" type="button" data-action="pay-invoice" data-invoice-id="${escapeHTML(invoice.id)}">Paga ora</button>
                    </span>
                  </span>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function renderFamilyHome() {
    const student = getSelectedStudent();
    if (!student) {
      return `
        ${pageHeader("Area famiglia", "Benvenuti!", "Il profilo non ha ancora allievi associati.", "", true)}
        <div class="card empty-state"><span class="empty-state__icon">${icon("users", 24)}</span><h3>Associazione in corso</h3><p>Contatta Valeria per completare il collegamento dell’allievo alla tua famiglia.</p>${supportActions()}</div>
      `;
    }
    const course = courseForStudent(student.id);
    const currentEnrollment = enrollmentForStudent(student.id);
    const recoveryAllowed =
      recoveryAllowedForEnrollment(currentEnrollment);
    const recoveryNoticeHours =
      recoveryNoticeHoursForEnrollment(currentEnrollment);
    const now = new Date();
    const studentLessons = lessonsForStudent(student.id);
    const upcoming = studentLessons.filter(
      (lesson) =>
        new Date(lesson.starts_at) >= now &&
        !String(lesson.status).startsWith("cancelled"),
    );
    const upcomingClosures = schoolClosuresForStudent(student.id).filter(
      (closure) => closure.closure_date >= todayKey(),
    );
    const nextClosure = upcomingClosures[0] || null;
    const futureCancelled = studentLessons.filter(
      (lesson) =>
        new Date(lesson.starts_at) >= now &&
        String(lesson.status).startsWith("cancelled"),
    );
    const nextLesson = upcoming[0] || null;
    const stats = studentAttendanceStats(student.id);
    const makeups = state.data.makeupCredits.filter(
      (item) =>
        item.student_id === student.id &&
        ["available", "proposed", "scheduled"].includes(
          makeupEffectiveStatus(item),
        ),
    );
    const invoices = familyOpenInvoices();
    const balance = invoices.reduce(
      (sum, item) => sum + invoiceOutstandingCents(item),
      0,
    );
    const family = familyForStudent(student);
    const firstName =
      state.profile?.display_name?.split(" ")[0] ||
      family?.guardian_name?.split(" ")[0] ||
      "famiglia";

    return `
      ${pageHeader(
        "Il vostro percorso musicale",
        `Ciao ${firstName}!`,
        `Qui trovi tutto il percorso di ${student.first_name}, sempre aggiornato.`,
        familyStudentSwitcher(),
        true,
      )}

      ${renderFamilyPaymentReminders()}

      ${
        nextClosure
          ? `<div class="closure-callout" style="margin-bottom:18px">${icon("calendar", 18)}<p><strong>${escapeHTML(SCHOOL_CLOSURE_TITLE)} · ${escapeHTML(formatDate(nextClosure.closure_date, { weekday: "long", day: "numeric", month: "long" }))}.</strong> ${escapeHTML(schoolClosureFamilyDescription(nextClosure))}</p></div>`
          : ""
      }

      <section class="grid grid--family">
        <article class="hero-card">
          <div class="hero-card__content">
            <span class="hero-card__kicker">${nextLesson ? "Prossima lezione" : "Calendario"}</span>
            ${
              nextLesson
                ? `
                  <h2>${escapeHTML(
                    formatDate(nextLesson.starts_at, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    }),
                  )}</h2>
                  <p>${escapeHTML(nextLesson.title || course?.name || "Lezione")} con Valeria. Ti aspettiamo allo Studio Quarto MoVimento!</p>
                  <div class="hero-card__meta">
                    <span class="hero-chip">${icon("clock", 14)} ${escapeHTML(formatTime(nextLesson.starts_at))}–${escapeHTML(formatTime(nextLesson.ends_at))}</span>
                    <span class="hero-chip">${icon("map", 14)} ${escapeHTML(nextLesson.location || course?.location || "Studio")}</span>
                  </div>
                `
                : `
                  <h2>Nessuna lezione in arrivo</h2>
                  <p>Il calendario del percorso verrà aggiornato appena saranno definite le prossime date.</p>
                `
            }
          </div>
        </article>

        <article class="balance-card">
          <div>
            <span class="balance-card__label">Saldo da pagare</span>
            <div class="balance-card__value">${escapeHTML(formatMoney(balance))}</div>
            <p class="balance-card__meta">${invoices.length ? `${invoices.length} ${invoices.length === 1 ? "scadenza aperta" : "scadenze aperte"}` : "Nessuna scadenza aperta"}</p>
          </div>
          <a class="btn btn--yellow btn--sm" href="#/famiglia/payments">${invoices.length ? "Vai ai pagamenti" : "Vedi lo storico"} ${icon("arrowRight", 14)}</a>
        </article>
      </section>

      <section class="grid grid--stats" style="margin-top:18px">
        ${statCard("Presenze", stats.present, `${stats.rate}% di frequenza`, "check")}
        ${statCard("Assenze", stats.absent, `${stats.total} lezioni registrate`, "calendar")}
        ${statCard("Recuperi", makeups.length, makeups.some((item) => item.status === "scheduled") ? "Uno già programmato" : "Crediti disponibili", "repeat")}
        ${statCard("Percorso", LABELS.plan[enrollmentForStudent(student.id)?.plan_type] || "—", course?.name || "Nessun corso", "music")}
      </section>

      <section class="grid grid--family" style="margin-top:18px">
        <article class="card">
          <header class="card-header">
            <div><h2>Le prossime date</h2><p>Lezioni e recuperi in calendario</p></div>
            <a class="btn btn--ghost btn--sm" href="#/famiglia/lessons">Calendario ${icon("arrowRight", 14)}</a>
          </header>
          ${renderScheduleList(upcoming.slice(0, 4), "Non ci sono altre lezioni programmate.")}
        </article>

        <article class="card">
          <header class="card-header">
            <div><h2>La frequenza di ${escapeHTML(student.first_name)}</h2><p>Presenze sulle lezioni registrate</p></div>
          </header>
          <div class="ring-wrap">
            <div class="ring" style="--ring-value:${stats.rate}"><span class="ring__value">${stats.rate}%</span></div>
            <div class="ring-legend">
              <div class="legend-row"><span class="legend-row__label"><span class="dot" style="background:var(--brand-aqua)"></span>Presente</span><strong>${stats.present}</strong></div>
              <div class="legend-row"><span class="legend-row__label"><span class="dot" style="background:var(--danger)"></span>Assente</span><strong>${stats.absent}</strong></div>
              <div class="legend-row"><span class="legend-row__label"><span class="dot" style="background:#e7ecef"></span>Totale</span><strong>${stats.total}</strong></div>
            </div>
          </div>
          <a class="btn btn--secondary btn--sm" style="width:100%;margin-top:20px" href="#/famiglia/attendance">Vedi il dettaglio</a>
        </article>
      </section>

      <div class="info-callout" style="margin-top:18px">
        ${icon("info", 18)}
        <p>Se ${escapeHTML(student.first_name)} non può partecipare, avvisa Valeria almeno <strong>${escapeHTML(recoveryNoticeHours)} ore prima</strong>. ${recoveryAllowed ? "Il recupero può essere riconosciuto secondo il piano e la disponibilità di un gruppo compatibile." : "Il piano attuale non prevede un recupero automatico."}</p>
      </div>
      ${student.notes ? `<div class="info-callout" style="margin-top:12px">${icon("music", 18)}<p><strong>Nota sul percorso:</strong> ${escapeHTML(student.notes)}</p></div>` : ""}
      ${
        futureCancelled.length
          ? `<div class="info-callout" style="margin-top:12px;color:var(--danger);background:var(--danger-bg)">${icon("alert", 18)}<p><strong>${futureCancelled.length === 1 ? "Una lezione futura è stata annullata." : `${futureCancelled.length} lezioni future sono state annullate.`}</strong> ${escapeHTML(futureCancelled[0].cancellation_reason || "Apri il calendario per vedere il dettaglio.")}</p></div>`
          : ""
      }
      <section class="card" style="margin-top:18px">
        <header class="card-header">
          <div><h2>Serve una mano?</h2><p>Scrivi a Valeria o prenota un colloquio.</p></div>
        </header>
        ${supportActions()}
      </section>
    `;
  }

  function renderFamilyLessons() {
    const student = getSelectedStudent();
    const lessons = student ? lessonsForStudent(student.id) : [];
    const now = new Date();
    const upcoming = lessons.filter(
      (item) => new Date(item.starts_at) >= now,
    );
    const upcomingClosures = student
      ? schoolClosuresForStudent(student.id).filter(
          (closure) => closure.closure_date >= todayKey(),
        )
      : [];
    const upcomingEntries = [
      ...upcoming.map((lesson) => ({
        kind: "lesson",
        lesson,
        sortAt: new Date(lesson.starts_at).getTime(),
      })),
      ...upcomingClosures.map((closure) => ({
        kind: "closure",
        closure,
        sortAt: toLocalDate(closure.closure_date).getTime(),
      })),
    ].sort((a, b) => a.sortAt - b.sortAt);
    const past = lessons
      .filter((item) => new Date(item.starts_at) < now)
      .reverse()
      .slice(0, 6);

    return `
      ${pageHeader(
        "Agenda",
        "Lezioni e appuntamenti",
        student
          ? `Tutte le date del percorso di ${student.first_name}.`
          : "Calendario delle lezioni.",
        `${familyStudentSwitcher()}<button class="btn btn--secondary" type="button" data-action="download-ics" data-student-id="${escapeHTML(student?.id || "")}">${icon("download", 16)} Aggiungi al calendario</button>`,
      )}
      <section class="grid grid--family">
        <article class="card">
          <header class="card-header">
            <div><h2>Prossime date</h2><p>${upcomingEntries.length} ${upcomingEntries.length === 1 ? "voce in calendario" : "voci in calendario"}</p></div>
          </header>
          ${
            upcomingEntries.length
              ? `<div class="schedule-list">${upcomingEntries
                  .map((entry) => {
                    if (entry.kind === "closure") {
                      const closure = entry.closure;
                      return `
                        <div class="schedule-item is-closure">
                          <span class="schedule-time">${escapeHTML(formatDate(closure.closure_date, { day: "numeric", month: "short" }))}</span>
                          <span class="schedule-line"></span>
                          <span class="schedule-copy">
                            <strong>${escapeHTML(SCHOOL_CLOSURE_TITLE)}</strong>
                            <span>${escapeHTML(schoolClosureFamilyDescription(closure))}</span>
                          </span>
                        </div>
                      `;
                    }
                    const lesson = entry.lesson;
                    const course = courseForLesson(lesson);
                    const isMakeup = ["makeup", "recovery"].includes(
                      lesson.lesson_type,
                    );
                    const isCancelled = String(lesson.status).startsWith(
                      "cancelled",
                    );
                    return `
                      <div class="schedule-item">
                        <span class="schedule-time">${escapeHTML(formatDate(lesson.starts_at, { day: "numeric", month: "short" }))}</span>
                        <span class="schedule-line" style="background:${isCancelled ? "#94a3af" : isMakeup ? "var(--brand-orange)" : safeColor(course?.color)}"></span>
                        <span class="schedule-copy">
                          <strong>${escapeHTML(formatTime(lesson.starts_at))} · ${escapeHTML(lesson.title || course?.name || "Lezione")}</strong>
                          <span>${escapeHTML(lesson.location || course?.location || "Studio Quarto MoVimento")}${isCancelled && lesson.cancellation_reason ? ` · ${escapeHTML(lesson.cancellation_reason)}` : lesson.notes ? ` · ${escapeHTML(lesson.notes)}` : ""}</span>
                        </span>
                        ${isCancelled ? statusBadge("lessonStatus", lesson.status) : isMakeup ? `<span class="badge badge--warning">Recupero</span>` : ""}
                      </div>
                    `;
                  })
                  .join("")}</div>`
              : `<div class="empty-state"><span class="empty-state__icon">${icon("calendar", 22)}</span><h3>Nessuna data in arrivo</h3><p>Il calendario verrà aggiornato appena ci saranno nuove lezioni.</p></div>`
          }
        </article>

        <aside class="grid" style="align-content:start">
          <article class="card card--tinted-aqua">
            <header class="card-header"><div><h2>Il tuo corso</h2><p>Informazioni principali</p></div></header>
            <div class="activity-list">
              <div class="activity-item"><span class="activity-icon">${icon("music", 16)}</span><span class="activity-copy"><strong>${escapeHTML(courseForStudent(student?.id)?.name || "—")}</strong><span>${escapeHTML(LABELS.plan[enrollmentForStudent(student?.id)?.plan_type] || "Piano da definire")}</span></span></div>
              <div class="activity-item"><span class="activity-icon">${icon("clock", 16)}</span><span class="activity-copy"><strong>${escapeHTML(courseForStudent(student?.id)?.duration_minutes || "—")} minuti</strong><span>Durata indicativa della lezione</span></span></div>
              <div class="activity-item"><span class="activity-icon">${icon("map", 16)}</span><span class="activity-copy"><strong>${escapeHTML(courseForStudent(student?.id)?.location || state.data.settings.school_address || "Studio")}</strong><span>Sede del corso</span></span></div>
            </div>
          </article>
          <article class="card">
            <header class="card-header"><div><h2>Ultime lezioni</h2><p>Gli appuntamenti appena trascorsi</p></div></header>
            ${
              past.length
                ? `<div class="activity-list">${past
                    .map((lesson) => {
                      const record = attendanceFor(lesson.id, student.id);
                      const isCancelled = String(lesson.status).startsWith(
                        "cancelled",
                      );
                      const result = isCancelled
                        ? LABELS.lessonStatus[lesson.status]
                        : record
                          ? LABELS.attendance[record.status]
                          : LABELS.lessonStatus[lesson.status] ||
                            "Da aggiornare";
                      return `<div class="activity-item"><span class="activity-icon">${icon(!isCancelled && record?.status === "present" ? "checkSimple" : "calendar", 15)}</span><span class="activity-copy"><strong>${escapeHTML(formatDate(lesson.starts_at))}</strong><span>${escapeHTML(result)}</span></span></div>`;
                    })
                    .join("")}</div>`
                : `<p class="muted" style="font-size:12px">Nessuna lezione trascorsa.</p>`
            }
          </article>
        </aside>
      </section>
    `;
  }

  function renderFamilyAttendance() {
    const student = getSelectedStudent();
    const absenceWhatsappUrl = whatsappUrl(
      student
        ? `Ciao Valeria, vorrei comunicare l’assenza di ${fullName(student)}.`
        : "Ciao Valeria, vorrei comunicare un’assenza.",
    );
    const stats = studentAttendanceStats(student?.id);
    const records = state.data.attendance
      .filter((item) => item.student_id === student?.id)
      .map((record) => ({
        ...record,
        lesson: state.data.lessons.find(
          (item) => item.id === record.lesson_id,
        ),
      }))
      .filter(
        (item) =>
          item.lesson &&
          !String(item.lesson.status).startsWith("cancelled") &&
          !lessonIsOnSchoolClosure(item.lesson),
      )
      .sort(
        (a, b) =>
          new Date(b.lesson.starts_at) - new Date(a.lesson.starts_at),
      );
    const excused = records.filter(
      (item) => item.status === "absent_excused",
    ).length;
    const unexcused = records.filter(
      (item) => item.status === "absent_unexcused",
    ).length;

    return `
      ${pageHeader(
        "Frequenza",
        `Presenze di ${student?.first_name || "tuo figlio"}`,
        "Il riepilogo delle lezioni svolte e delle assenze registrate.",
        familyStudentSwitcher(),
      )}
      <section class="grid grid--family">
        <article class="card">
          <header class="card-header"><div><h2>Riepilogo frequenza</h2><p>Dall’inizio del percorso</p></div></header>
          <div class="ring-wrap">
            <div class="ring" style="--ring-value:${stats.rate}"><span class="ring__value">${stats.rate}%</span></div>
            <div class="ring-legend">
              <div class="legend-row"><span class="legend-row__label"><span class="dot" style="background:var(--success)"></span>Presenze</span><strong>${stats.present}</strong></div>
              <div class="legend-row"><span class="legend-row__label"><span class="dot" style="background:var(--warning)"></span>Assenze avvisate</span><strong>${excused}</strong></div>
              <div class="legend-row"><span class="legend-row__label"><span class="dot" style="background:var(--danger)"></span>Non avvisate</span><strong>${unexcused}</strong></div>
            </div>
          </div>
        </article>

        <article class="card card--tinted-yellow">
          <header class="card-header"><div><h2>Come funzionano le assenze?</h2><p>La regola del tuo piano</p></div></header>
          <p class="muted" style="font-size:12px">Comunica l’assenza almeno <strong>${escapeHTML(state.data.settings.absence_notice_hours ?? 24)} ore prima per poter organizzare il recupero</strong>. Il piano mensile non prevede che le assenze vengano riconosciute sotto forma di credito; i piani trimestrali e annuali possono maturare recuperi. Per maggiori dettagli consulta il regolamento.</p>
          <div class="support-actions" style="margin-top:14px">
            <a href="${escapeHTML(absenceWhatsappUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn--primary btn--sm">${icon("calendar", 14)} Comunica la tua assenza</a>
            <a href="https://drive.google.com/file/d/1GnFRybVlJXnCPzXfwIK7jK5V45eLvrS1/view?usp=drive_link" target="_blank" rel="noopener noreferrer" class="btn btn--secondary btn--sm">Leggi il regolamento ${icon("arrowRight", 14)}</a>
          </div>
        </article>
      </section>

      <section class="card" style="margin-top:18px">
        <header class="card-header"><div><h2>Dettaglio lezioni</h2><p>${records.length} registrazioni</p></div></header>
        ${
          records.length
            ? `
              <div class="timeline">
                ${records
                  .map((record) => {
                    const isPresent = record.status === "present";
                    return `
                      <div class="timeline-item">
                        <span class="timeline-dot${isPresent ? "" : " is-absent"}">${isPresent ? "✓" : "–"}</span>
                        <span class="timeline-copy">
                          <strong>${escapeHTML(record.lesson.title || courseForLesson(record.lesson)?.name || "Lezione")}</strong>
                          <span>${escapeHTML(LABELS.attendance[record.status] || record.status)}</span>
                        </span>
                        <span class="timeline-date">${escapeHTML(formatDate(record.lesson.starts_at, { day: "numeric", month: "short" }))}</span>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            `
            : `<div class="empty-state"><span class="empty-state__icon">${icon("check", 22)}</span><h3>Registro ancora vuoto</h3><p>Le presenze compariranno qui dopo le prime lezioni.</p></div>`
        }
      </section>
    `;
  }

  function renderFamilyMakeups() {
    const student = getSelectedStudent();
    const items = state.data.makeupCredits.filter(
      (item) => item.student_id === student?.id,
    );
    const open = items.filter((item) =>
      ["available", "proposed", "scheduled"].includes(
        makeupEffectiveStatus(item),
      ),
    );
    const history = items.filter((item) =>
      ["used", "expired", "not_eligible", "cancelled"].includes(
        makeupEffectiveStatus(item),
      ),
    );
    const enrollment = enrollmentForStudent(student?.id);
    const canMakeup = recoveryAllowedForEnrollment(enrollment);

    const makeupRow = (item) => {
      const source = state.data.lessons.find(
        (lesson) => lesson.id === item.source_lesson_id,
      );
      const used = state.data.lessons.find(
        (lesson) => lesson.id === item.used_lesson_id,
      );
      return `
        <div class="makeup-item">
          <span class="makeup-icon">${icon("repeat", 18)}</span>
          <span class="makeup-copy">
            <strong>${escapeHTML(makeupEffectiveStatus(item) === "scheduled" && used ? `Recupero del ${formatDate(used.starts_at)}` : item.reason || "Credito di recupero")}</strong>
            <span>${source ? `Da lezione del ${formatDate(source.starts_at)}` : "Recupero"}${item.expires_on ? ` · entro ${formatDate(item.expires_on)}` : ""}</span>
          </span>
          ${statusBadge("makeup", makeupEffectiveStatus(item))}
        </div>
      `;
    };

    return `
      ${pageHeader(
        "Recuperi",
        `Recuperi di ${student?.first_name || "tuo figlio"}`,
        "Crediti maturati, proposte e lezioni già programmate.",
        familyStudentSwitcher(),
      )}
      <section class="grid grid--family">
        <article class="card">
          <header class="card-header"><div><h2>Recuperi aperti</h2><p>${open.length} ${open.length === 1 ? "credito attivo" : "crediti attivi"}</p></div></header>
          ${
            open.length
              ? `<div class="makeup-list">${open.map(makeupRow).join("")}</div>`
              : `<div class="empty-state"><span class="empty-state__icon">${icon("repeat", 22)}</span><h3>Nessun recupero aperto</h3><p>Quando un recupero è disponibile o programmato, lo vedrai qui.</p></div>`
          }
        </article>

        <aside class="card ${canMakeup ? "card--tinted-aqua" : "card--tinted-yellow"}">
          <header class="card-header"><div><h2>Il piano di ${escapeHTML(student?.first_name || "")}</h2><p>${escapeHTML(LABELS.plan[enrollment?.plan_type] || "Da definire")}</p></div></header>
          <div class="info-callout">
            ${icon("info", 18)}
            <p>${
              canMakeup
                ? "Il piano può prevedere recuperi per assenze comunicate nei tempi, entro la scadenza indicata e in un gruppo compatibile."
                : "Il piano attuale non prevede recuperi automatici: eventuali eccezioni vengono concordate direttamente con Valeria."
            }</p>
          </div>
          <p class="muted" style="margin:16px 0 0;font-size:11px">I recuperi vengono proposti e assegnati da Valeria in base all’età, al percorso e ai posti disponibili.</p>
        </aside>
      </section>
      ${
        history.length
          ? `<section class="card" style="margin-top:18px"><header class="card-header"><div><h2>Storico</h2><p>Recuperi conclusi o non applicabili</p></div></header><div class="makeup-list">${history.map(makeupRow).join("")}</div></section>`
          : ""
      }
    `;
  }

  function bankDetails(invoice) {
    const settings = state.data.settings || {};
    const student = studentForInvoice(invoice);
    const reference = String(
      settings.bank_reference_template || BANK_REFERENCE_TEMPLATE,
    )
      .replace(/\{nome\}/gi, student?.first_name || "")
      .replace(/\{cognome\}/gi, student?.last_name || "")
      .replace(/\{allievo\}/gi, fullName(student))
      .replace(/\{numero(?:\s+fattura)?\}/gi, invoice.number || "");
    return `
      <div class="bank-box">
        <div class="bank-box__row"><span>Intestatario</span><strong>${escapeHTML(settings.bank_account_holder || "Da comunicare")}</strong></div>
        <div class="bank-box__row"><span>IBAN</span><strong>${escapeHTML(settings.bank_iban || "Da comunicare")} ${settings.bank_iban ? `<button class="copy-button" type="button" data-action="copy-value" data-value="${escapeHTML(settings.bank_iban)}">${icon("copy", 11)} Copia</button>` : ""}</strong></div>
        ${settings.bank_bic ? `<div class="bank-box__row"><span>BIC/SWIFT</span><strong>${escapeHTML(settings.bank_bic)}</strong></div>` : ""}
        <div class="bank-box__row"><span>Importo</span><strong>${escapeHTML(formatMoney(invoiceOutstandingCents(invoice), invoice.currency))}</strong></div>
        <div class="bank-box__row"><span>Causale</span><strong>${escapeHTML(reference)} <button class="copy-button" type="button" data-action="copy-value" data-value="${escapeHTML(reference)}">${icon("copy", 11)} Copia</button></strong></div>
      </div>
    `;
  }

  function renderFamilyPayments() {
    const open = familyOpenInvoices();
    const history = state.data.invoices
      .filter((item) => invoiceEffectiveStatus(item) === "paid")
      .sort((a, b) => new Date(b.paid_at || 0) - new Date(a.paid_at || 0));
    const balance = open.reduce(
      (sum, item) => sum + invoiceOutstandingCents(item),
      0,
    );
    const nextInvoice = open.find(
      (item) => invoiceEffectiveStatus(item) !== "processing",
    );

    return `
      ${pageHeader(
        "Quote e scadenze",
        "Pagamenti",
        "Controlla il saldo e scegli come pagare in sicurezza.",
        supportActions(),
      )}
      ${renderFamilyPaymentReminders()}
      <section class="grid grid--family">
        <article class="balance-card">
          <div>
            <span class="balance-card__label">Totale da pagare</span>
            <div class="balance-card__value">${escapeHTML(formatMoney(balance))}</div>
            <p class="balance-card__meta">${open.length ? `Prossima scadenza ${formatDate(open[0].due_date)}` : "Sei in regola con tutti i pagamenti"}</p>
          </div>
          ${nextInvoice ? `<button class="btn btn--yellow btn--sm" type="button" data-action="pay-invoice" data-invoice-id="${escapeHTML(nextInvoice.id)}">Paga ora ${icon("arrowRight", 14)}</button>` : ""}
        </article>

        <article class="card card--tinted-aqua">
          <header class="card-header"><div><h2>Pagamento sicuro</h2><p>PayPal oppure bonifico bancario</p></div></header>
          <div class="activity-list">
            <div class="activity-item"><span class="activity-icon">${icon("card", 16)}</span><span class="activity-copy"><strong>PayPal</strong><span>Paga dal profilo PayPal di Quarto MoVimento.</span></span><a class="btn btn--yellow btn--sm" href="${PAYPAL_ME_URL}" target="_blank" rel="noopener noreferrer">Apri PayPal</a></div>
            <div class="activity-item"><span class="activity-icon">${icon("bank", 16)}</span><span class="activity-copy"><strong>Bonifico</strong><span>Usa come causale nome, cognome e numero fattura.</span></span></div>
          </div>
          <p class="subtle" style="margin:12px 0 0;font-size:10px">I dati PayPal sono gestiti da PayPal. L’app non memorizza dati di carta.</p>
        </article>
      </section>

      <section class="card" style="margin-top:18px">
        <header class="card-header"><div><h2>Scadenze aperte</h2><p>${open.length} ${open.length === 1 ? "voce da gestire" : "voci da gestire"}</p></div></header>
        ${
          open.length
            ? `<div class="payment-list">${open
                .map((invoice) => {
                  const student = studentForInvoice(invoice);
                  const status = invoiceEffectiveStatus(invoice);
                  return `
                    <div class="payment-item">
                      <span class="payment-item__copy">
                        <strong>${escapeHTML(invoice.title)}</strong>
                        <span>${escapeHTML(fullName(student))} · ${escapeHTML(invoice.number)} · scadenza ${escapeHTML(formatDate(invoice.due_date))}</span>
                      </span>
                      <span class="payment-item__amount">
                        <span class="money">${escapeHTML(formatMoney(invoiceOutstandingCents(invoice), invoice.currency))}</span>
                        <span style="display:flex;align-items:center;justify-content:flex-end;gap:6px">
                          ${statusBadge("invoice", invoicePaymentStatus(invoice))}
                          ${
                            status === "processing"
                              ? ""
                              : `<button class="btn btn--primary btn--sm" type="button" data-action="pay-invoice" data-invoice-id="${escapeHTML(invoice.id)}">Paga</button>`
                          }
                        </span>
                      </span>
                    </div>
                  `;
                })
                .join("")}</div>`
            : `<div class="empty-state"><span class="empty-state__icon">${icon("check", 23)}</span><h3>Tutto pagato</h3><p>Non risultano quote o rate aperte.</p></div>`
        }
      </section>

      ${
        history.length
          ? `
            <section class="card" style="margin-top:18px">
              <header class="card-header"><div><h2>Storico pagamenti</h2><p>Quote già registrate</p></div></header>
              <div class="payment-list">
                ${history
                  .map((invoice) => {
                    const student = studentForInvoice(invoice);
                    const latestPayment = paymentsForInvoice(invoice.id)
                      .filter((payment) =>
                        ["completed", "partially_refunded"].includes(
                          payment.status,
                        ),
                      )
                      .sort(
                        (a, b) =>
                          new Date(b.paid_at || b.created_at || 0) -
                          new Date(a.paid_at || a.created_at || 0),
                      )[0];
                    return `
                      <div class="payment-item">
                        <span class="payment-item__copy"><strong>${escapeHTML(invoice.title)}</strong><span>${escapeHTML(fullName(student))} · pagato il ${escapeHTML(formatDate(latestPayment?.paid_at || invoice.paid_at))} via ${escapeHTML(paymentMethodLabel(latestPayment?.method || invoice.payment_method))}</span></span>
                        <span class="payment-item__amount"><span class="money">${escapeHTML(formatMoney(invoice.total_cents, invoice.currency))}</span>${statusBadge("invoice", "paid")}</span>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          `
          : ""
      }
    `;
  }

  function courseOptions(selectedId) {
    return state.data.courses
      .filter((item) => item.is_active !== false || item.id === selectedId)
      .map(
        (course) =>
          `<option value="${escapeHTML(course.id)}"${course.id === selectedId ? " selected" : ""}>${escapeHTML(course.name)}</option>`,
      )
      .join("");
  }

  function familyOptions(selectedId) {
    return state.data.families
      .map(
        (family) =>
          `<option value="${escapeHTML(family.id)}"${family.id === selectedId ? " selected" : ""}>${escapeHTML(family.display_name || family.guardian_name)}</option>`,
      )
      .join("");
  }

  function openStudentModal(studentId) {
    const student = studentId
      ? state.data.students.find((item) => item.id === studentId)
      : null;
    const family = student ? familyForStudent(student) : null;
    const accessEmails = familyAccessEmails(family);
    const linkedEmails = familyLinkedAccessEmails(family);
    const primaryEmail = normalizeEmailList([family?.email])[0] || "";
    const additionalEmails = accessEmails.filter(
      (email) => email !== primaryEmail,
    );
    const enrollment = student ? enrollmentForStudent(student.id) : null;
    const defaultEnd = state.data.settings.academic_year_end || "";
    openModal({
      title: student ? `Modifica ${fullName(student)}` : "Nuovo allievo",
      subtitle: student
        ? "Aggiorna anagrafica, corso e piano."
        : "Aggiungi l’allievo; il link famiglia si genera poi dalla sua scheda.",
      className: "modal--lg",
      body: `
        <form id="student-form">
          <input type="hidden" name="id" value="${escapeHTML(student?.id || "")}" />
          <div class="setting-section" style="margin:0;padding:0;border:0">
            <h3>Dati dell’allievo</h3>
            <p>Le informazioni necessarie per riconoscere il percorso.</p>
            <div class="form-grid">
              <div class="field"><label for="student-first-name">Nome</label><input class="input" id="student-first-name" name="first_name" value="${escapeHTML(student?.first_name || "")}" required /></div>
              <div class="field"><label for="student-last-name">Cognome</label><input class="input" id="student-last-name" name="last_name" value="${escapeHTML(student?.last_name || "")}" required /></div>
              <div class="field"><label for="student-birth-date">Data di nascita</label><input class="input" id="student-birth-date" name="birth_date" type="date" value="${escapeHTML(student?.birth_date || "")}" /></div>
              <div class="field"><label for="student-fiscal-code">Codice fiscale</label><input class="input" id="student-fiscal-code" name="fiscal_code" value="${escapeHTML(student?.fiscal_code || "")}" maxlength="16" pattern="[A-Za-z0-9]{16}" autocomplete="off" placeholder="16 caratteri" /></div>
              <div class="field field--full"><label for="student-residence-address">Indirizzo di residenza</label><input class="input" id="student-residence-address" name="residence_address" value="${escapeHTML(student?.residence_address || "")}" autocomplete="street-address" placeholder="Via, numero civico, CAP, città" /></div>
              <div class="field field--full"><label for="student-notes">Nota condivisa</label><input class="input" id="student-notes" name="notes" value="${escapeHTML(student?.notes || "")}" placeholder="Visibile anche alla famiglia" /></div>
            </div>
          </div>
          <div class="setting-section">
            <h3>Famiglia e contatti</h3>
            <p>Gli indirizzi della stessa famiglia restano collegati allo stesso nucleo, anche in presenza di fratelli.</p>
            <div class="form-grid">
              <div class="field field--full">
                <label for="student-family-id">Nucleo esistente</label>
                <select class="select" id="student-family-id" name="family_id">
                  <option value="">Crea una nuova famiglia</option>
                  ${familyOptions(family?.id || "")}
                </select>
              </div>
              <div class="field"><label for="guardian-name">Nome del genitore/tutore</label><input class="input" id="guardian-name" name="guardian_name" value="${escapeHTML(family?.guardian_name || "")}" placeholder="Es. Giulia Bianchi" /></div>
              <div class="field"><label for="family-display-name">Nome famiglia</label><input class="input" id="family-display-name" name="family_display_name" value="${escapeHTML(family?.display_name || "")}" placeholder="Es. Famiglia Bianchi" /></div>
              <div class="field"><label for="guardian-email">E-mail principale</label><input class="input" id="guardian-email" name="email" type="email" value="${escapeHTML(family?.email || "")}" required /></div>
              <div class="field"><label for="guardian-phone">Telefono</label><input class="input" id="guardian-phone" name="phone" type="tel" value="${escapeHTML(family?.phone || "")}" /></div>
              ${linkedEmails.length ? `<div class="field field--full"><label>Account già collegati</label><p class="field-hint">${linkedEmails.map((email) => escapeHTML(email)).join(" · ")}</p></div>` : `<div class="field field--full"><p class="field-hint">Dopo il salvataggio potrai generare manualmente il link dalla scheda dell’allievo.</p></div>`}
              <div class="field field--full"><label for="guardian-additional-emails">Altre e-mail di accesso</label><textarea class="textarea" id="guardian-additional-emails" name="additional_emails" rows="3" placeholder="Un indirizzo per riga, oppure separati da virgola">${escapeHTML(additionalEmails.join("\n"))}</textarea><p class="field-hint">Puoi indicare fino a 10 indirizzi aggiuntivi. Nessuna e-mail viene inviata automaticamente.</p></div>
            </div>
          </div>
          <div class="setting-section">
            <h3>Corso e piano</h3>
            <p>Il piano determina scadenze e diritto ai recuperi.</p>
            <div class="form-grid form-grid--three">
              <div class="field field--full"><label for="student-course">Corso</label><select class="select" id="student-course" name="course_id" required><option value="">Scegli il corso</option>${courseOptions(enrollment?.course_id || "")}</select></div>
              <div class="field"><label for="student-plan">Piano</label><select class="select" id="student-plan" name="plan_type">${enrollment?.plan_type && !["trial", "trial_package_2", "monthly", "quarterly", "annual", "workshop"].includes(enrollment.plan_type) ? `<option value="${escapeHTML(enrollment.plan_type)}" selected>${escapeHTML(LABELS.plan[enrollment.plan_type] || enrollment.plan_type)} · piano precedente</option>` : ""}${Object.entries(LABELS.plan)
                .filter(([key]) =>
                  [
                    "trial",
                    "trial_package_2",
                    "monthly",
                    "quarterly",
                    "annual",
                    "workshop",
                  ].includes(key),
                )
                .map(
                  ([key, label]) =>
                    `<option value="${key}"${enrollment?.plan_type === key ? " selected" : ""}>${escapeHTML(label)}</option>`,
                )
                .join("")}</select></div>
              <div class="field"><label for="student-starts">Inizio</label><input class="input" id="student-starts" name="starts_on" type="date" value="${escapeHTML(enrollment?.starts_on || todayKey())}" required /></div>
              <div class="field"><label for="student-ends">Fine</label><input class="input" id="student-ends" name="ends_on" type="date" value="${escapeHTML(enrollment?.ends_on || defaultEnd)}" /></div>
              <div class="field field--full"><label for="student-enrollment-notes">Note del piano</label><textarea class="textarea" id="student-enrollment-notes" name="enrollment_notes" rows="3" placeholder="Es. accordi sul pagamento o indicazioni sulla frequenza">${escapeHTML(enrollment?.notes || "")}</textarea><p class="field-hint">Annotazioni relative al piano, ai pagamenti o alla frequenza.</p></div>
            </div>
          </div>
        </form>
      `,
      footer: `
        ${student ? `<button class="btn btn--danger" type="button" data-action="delete-student" data-student-id="${escapeHTML(student.id)}">${icon("trash", 15)} Elimina allievo</button>` : ""}
        <button class="btn btn--secondary" type="button" data-action="close-modal">Annulla</button>
        <button class="btn btn--primary" type="submit" form="student-form">${student ? "Salva modifiche" : "Aggiungi allievo"}</button>
      `,
    });
  }

  function familyAccountStatusPresentation(account) {
    const status = account?.status || account?.account_status || "unknown";
    if (status === "active") {
      return {
        label: "Account attivo",
        badgeClass: "badge--success",
        canGenerate: false,
        buttonLabel: "",
      };
    }
    if (status === "pending") {
      return {
        label: "In attesa di attivazione",
        badgeClass: "badge--warning",
        canGenerate: true,
        buttonLabel: "Genera nuovo link",
      };
    }
    if (status === "disabled") {
      return {
        label: "Account disattivato",
        badgeClass: "badge--danger",
        canGenerate: false,
        buttonLabel: "",
      };
    }
    if (status === "role_invalid") {
      return {
        label: "Indirizzo non utilizzabile",
        badgeClass: "badge--danger",
        canGenerate: false,
        buttonLabel: "",
      };
    }
    return {
      label: status === "error" ? "Stato non disponibile" : "Account da attivare",
      badgeClass: status === "error" ? "badge--danger" : "badge--plain",
      canGenerate: true,
      buttonLabel: "Genera link di invito",
    };
  }

  async function openStudentDetails(studentId, actionTarget) {
    const student = state.data.students.find((item) => item.id === studentId);
    if (!student) return;
    const family = familyForStudent(student);
    const accessEmails = familyAccessEmails(family);
    let statusError = null;
    if (family && accessEmails.length) {
      setButtonLoading(actionTarget, true, "Verifica…");
      try {
        const result = await state.store.getFamilyAccountStatuses({
          familyId: family.id,
          emails: accessEmails,
        });
        rememberFamilyAccountStatuses(family.id, result.accounts);
      } catch (error) {
        statusError = error;
        accessEmails.forEach((email) => {
          state.familyAccountStatuses[
            familyAccountStatusKey(family.id, email)
          ] = { email, status: "error" };
        });
      } finally {
        setButtonLoading(actionTarget, false);
      }
    }
    const course = courseForStudent(student.id);
    const enrollment = enrollmentForStudent(student.id);
    const stats = studentAttendanceStats(student.id);
    const invoices = state.data.invoices.filter(
      (item) => item.student_id === student.id,
    );
    const age = ageFromBirth(student.birth_date);
    openModal({
      title: fullName(student),
      subtitle: `${course?.name || "Nessun corso"} · ${LABELS.plan[enrollment?.plan_type] || "piano da definire"}`,
      body: `
        <div class="grid grid--stats" style="grid-template-columns:repeat(3,1fr)">
          ${statCard("Età", age == null ? "—" : age, "anni", "users")}
          ${statCard("Frequenza", `${stats.rate}%`, `${stats.present} presenze`, "check")}
          ${statCard("Saldo", formatMoney(studentBalance(student.id)), `${invoices.length} movimenti`, "wallet")}
        </div>
        <div class="setting-section">
          <h3>Dati anagrafici</h3>
          <div class="activity-list">
            <div class="activity-item"><span class="activity-icon">${icon("info", 16)}</span><span class="activity-copy"><strong>${escapeHTML(student.fiscal_code || "—")}</strong><span>Codice fiscale</span></span></div>
            <div class="activity-item"><span class="activity-icon">${icon("map", 16)}</span><span class="activity-copy"><strong>${escapeHTML(student.residence_address || "—")}</strong><span>Indirizzo di residenza</span></span></div>
          </div>
        </div>
        <div class="setting-section">
          <h3>Contatti famiglia</h3>
          <p>${escapeHTML(family?.display_name || "")}</p>
          ${statusError ? `<div class="info-callout" style="margin-bottom:12px">${icon("alert", 18)}<p>Non è stato possibile verificare lo stato degli account. Puoi riprovare a generare il link; se il problema continua, controlla il deploy della funzione.</p></div>` : ""}
          <div class="activity-list">
            <div class="activity-item"><span class="activity-icon">${icon("users", 16)}</span><span class="activity-copy"><strong>${escapeHTML(family?.guardian_name || "—")}</strong><span>Genitore o tutore</span></span></div>
            ${accessEmails.length
              ? accessEmails
                  .map(
                    (email) => {
                      const isPrimary =
                        email === normalizeEmailList([family.email])[0];
                      const presentation = familyAccountStatusPresentation(
                        familyAccountStatus(family.id, email),
                      );
                      return `<div class="activity-item activity-item--with-action"><span class="activity-icon">${icon("mail", 16)}</span><span class="activity-copy"><strong>${escapeHTML(email)}</strong><span>${isPrimary ? "E-mail principale" : "Accesso famiglia aggiuntivo"}</span><span class="badge ${presentation.badgeClass}">${escapeHTML(presentation.label)}</span></span>${presentation.canGenerate ? `<button class="btn btn--secondary btn--sm" type="button" data-action="generate-family-link" data-family-id="${escapeHTML(family.id)}" data-student-id="${escapeHTML(student.id)}" data-email="${escapeHTML(email)}" data-guardian-name="${escapeHTML(isPrimary ? family.guardian_name || "" : "")}">${icon("copy", 15)} ${escapeHTML(presentation.buttonLabel)}</button>` : ""}</div>`;
                    },
                  )
                  .join("")
              : `<div class="activity-item"><span class="activity-icon">${icon("mail", 16)}</span><span class="activity-copy"><strong>—</strong><span>Nessuna e-mail di accesso</span></span></div>`}
            <div class="activity-item"><span class="activity-icon">${icon("phone", 16)}</span><span class="activity-copy"><strong>${escapeHTML(family?.phone || "—")}</strong><span>Telefono</span></span></div>
          </div>
        </div>
        ${student.notes ? `<div class="setting-section"><h3>Nota condivisa</h3><p class="muted">${escapeHTML(student.notes)}</p></div>` : ""}
        ${enrollment?.notes ? `<div class="setting-section"><h3>Note del piano</h3><p class="muted">${escapeHTML(enrollment.notes)}</p></div>` : ""}
      `,
      footer: `
        <button class="btn btn--danger" type="button" data-action="delete-student" data-student-id="${escapeHTML(student.id)}">${icon("trash", 15)} Elimina</button>
        <button class="btn btn--secondary" type="button" data-action="close-modal">Chiudi</button>
        <button class="btn btn--primary" type="button" data-action="edit-student" data-student-id="${escapeHTML(student.id)}">${icon("edit", 15)} Modifica</button>
      `,
    });
  }

  function openSchoolClosureModal(dateValue) {
    const date = dateValue || state.calendarSelectedDate || todayKey();
const closure =
  (state.data.schoolClosures || []).find(
    (item) => item.closure_date === date,
  ) || null;

const automaticClosure =
  automaticSchoolClosures().find(
    (item) => item.closure_date === date,
  ) || null;

if (automaticClosure) {
  toast(
    "Chiusura prevista dal regolamento",
    automaticClosure.description,
  );
  return;
}
    if (!closure && date < todayKey()) {
      toast(
        "Data non modificabile",
        "Puoi segnare come chiusura soltanto oggi o una data futura.",
        "error",
      );
      return;
    }
    const manualLessons = state.data.lessons.filter(
      (lesson) =>
        lesson.origin === "manual" &&
        dateKey(lesson.starts_at) === date &&
        ["scheduled", "completed"].includes(lesson.status),
    ).length;
    openModal({
      title: SCHOOL_CLOSURE_TITLE,
      subtitle: closure
        ? `Chiusura del ${formatDate(date)}`
        : "Segna una giornata in cui lo studio resta chiuso.",
      className: "modal--sm",
      body: `
        <form id="school-closure-form">
          <input type="hidden" name="closure_date" value="${escapeHTML(date)}" />
          <div class="form-grid">
            <div class="field field--full">
              <label for="school-closure-date">Data</label>
              <input class="input" id="school-closure-date" type="date" value="${escapeHTML(date)}" disabled />
            </div>
            <div class="field field--full">
              <label for="school-closure-description">Descrizione facoltativa</label>
              <input class="input" id="school-closure-description" name="description" maxlength="120" value="${escapeHTML(schoolClosureDescription(closure))}" placeholder="Es. Festa patronale" />
              <p class="field-hint">Nel calendario comparirà sempre “${escapeHTML(SCHOOL_CLOSURE_TITLE)}”.</p>
            </div>
          </div>
          <div class="closure-callout" style="margin-top:16px">
            ${icon("calendar", 18)}
            <p>${manualLessons ? `Ci sono ${manualLessons} ${manualLessons === 1 ? "appuntamento manuale programmato o già svolto" : "appuntamenti manuali programmati o già svolti"} in questa data. Finché sono presenti, la data non può essere segnata come chiusura.` : "Le lezioni ordinarie collegate ai corsi vengono tolte da questa data, non vengono conteggiate e non generano recuperi. Tornano automaticamente se la riapri."}</p>
          </div>
        </form>
      `,
      footer: `${closure ? `<button class="btn btn--danger" type="button" data-action="delete-school-closure" data-closure-id="${escapeHTML(closure.id)}">Riapri questa data</button>` : ""}<button class="btn btn--secondary" type="button" data-action="close-modal">Annulla</button><button class="btn btn--primary" type="submit" form="school-closure-form"${manualLessons && !closure ? " disabled" : ""}>${closure ? "Salva nota" : "Segna chiusura"}</button>`,
    });
  }

  function openLessonModal(dateValue, defaults) {
    const options = defaults || {};
    const date = dateValue || state.calendarSelectedDate || todayKey();
    if (schoolClosureForDate(date)) {
      toast(
        SCHOOL_CLOSURE_TITLE,
        "Riapri prima questa data per aggiungere una lezione.",
        "error",
      );
      return;
    }
    const defaultCourse =
      state.data.courses.find((item) => item.id === options.courseId) ||
      state.data.courses.find((item) => item.is_active !== false);
    const defaultType = options.lessonType || "regular";
    openModal({
      title:
        defaultType === "makeup" || defaultType === "recovery"
          ? "Nuova sessione di recupero"
          : "Nuova lezione",
      subtitle:
        "Qui aggiungi una data singola. Le serie ordinarie si gestiscono dalle impostazioni del corso.",
      className: "modal--lg",
      body: `
        <form id="lesson-form">
          <div class="form-grid">
            <div class="field field--full"><label for="lesson-course">Corso</label><select class="select" id="lesson-course" name="course_id" required><option value="">Scegli il corso</option>${courseOptions(defaultCourse?.id || "")}</select></div>
            <div class="field"><label for="lesson-date">Data</label><input class="input" id="lesson-date" name="date" type="date" value="${escapeHTML(date)}" required /></div>
            <div class="field"><label for="lesson-time">Ora di inizio</label><input class="input" id="lesson-time" name="time" type="time" value="16:30" required /></div>
            <div class="field"><label for="lesson-type">Tipo</label><select class="select" id="lesson-type" name="lesson_type"><option value="regular"${defaultType === "regular" ? " selected" : ""}>Lezione ordinaria</option><option value="makeup"${["makeup", "recovery"].includes(defaultType) ? " selected" : ""}>Recupero</option><option value="trial"${defaultType === "trial" ? " selected" : ""}>Lezione di prova</option><option value="event"${defaultType === "event" ? " selected" : ""}>Laboratorio/evento</option><option value="extra"${defaultType === "extra" ? " selected" : ""}>Extra</option></select></div>
            <div class="field"><label for="lesson-duration">Durata (minuti)</label><input class="input" id="lesson-duration" name="duration_minutes" type="number" min="15" max="240" step="5" value="${escapeHTML(defaultCourse?.duration_minutes || 50)}" required /></div>
            <div class="field field--full"><label for="lesson-title">Titolo personalizzato</label><input class="input" id="lesson-title" name="title" placeholder="Facoltativo: se vuoto usa il nome del corso" /></div>
            <div class="field field--full"><label for="lesson-location">Sede</label><input class="input" id="lesson-location" name="location" value="${escapeHTML(defaultCourse?.location || state.data.settings.school_address || "Studio Quarto MoVimento")}" /></div>
            <div class="field"><label for="lesson-notes">Nota sulla lezione</label><input class="input" id="lesson-notes" name="notes" placeholder="Visibile anche alle famiglie iscritte" /></div>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn--secondary" type="button" data-action="close-modal">Annulla</button>
        <button class="btn btn--primary" type="submit" form="lesson-form">Crea lezione</button>
      `,
    });
  }

  function openAssignMakeupModal(creditId) {
    const credit = state.data.makeupCredits.find(
      (item) => item.id === creditId,
    );
    if (!credit) return;
    const student = state.data.students.find(
      (item) => item.id === credit.student_id,
    );
    const source = state.data.lessons.find(
      (item) => item.id === credit.source_lesson_id,
    );
    const compatible = state.data.lessons
      .filter(
        (lesson) =>
          lesson.course_id === source?.course_id &&
          ["makeup", "recovery"].includes(lesson.lesson_type) &&
          lesson.status === "scheduled" &&
          new Date(lesson.starts_at) > new Date() &&
          !lessonIsOnSchoolClosure(lesson) &&
          (!credit.expires_on ||
            dateKey(lesson.starts_at) <= credit.expires_on),
      )
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    openModal({
      title: `Assegna recupero · ${fullName(student)}`,
      subtitle: source
        ? `Credito dalla lezione del ${formatDate(source.starts_at)}`
        : "Credito di recupero",
      className: "modal--sm",
      body: compatible.length
        ? `
          <form id="assign-makeup-form">
            <input type="hidden" name="credit_id" value="${escapeHTML(credit.id)}" />
            <div class="field">
              <label for="makeup-lesson-id">Sessione compatibile</label>
              <select class="select" id="makeup-lesson-id" name="lesson_id" required>
                <option value="">Scegli data e ora</option>
                ${compatible
                  .map(
                    (lesson) =>
                      `<option value="${escapeHTML(lesson.id)}">${escapeHTML(formatDate(lesson.starts_at, { weekday: "short", day: "numeric", month: "long" }))} · ${escapeHTML(formatTime(lesson.starts_at))} · ${escapeHTML(lesson.title || courseForLesson(lesson)?.name || "Recupero")}</option>`,
                  )
                  .join("")}
              </select>
            </div>
            <div class="info-callout" style="margin-top:16px">${icon("info", 17)}<p>L’assegnazione comparirà subito nel calendario della famiglia.</p></div>
          </form>
        `
        : `
          <div class="empty-state">
            <span class="empty-state__icon">${icon("calendar", 22)}</span>
            <h3>Nessuna sessione compatibile</h3>
            <p>Crea prima una lezione di tipo recupero per lo stesso corso, entro la scadenza del credito.</p>
          </div>
        `,
      footer: compatible.length
        ? `<button class="btn btn--secondary" type="button" data-action="close-modal">Annulla</button><button class="btn btn--primary" type="submit" form="assign-makeup-form">Assegna recupero</button>`
        : `<button class="btn btn--secondary" type="button" data-action="close-modal">Chiudi</button><button class="btn btn--primary" type="button" data-action="create-makeup-lesson" data-course-id="${escapeHTML(source?.course_id || "")}">${icon("plus", 15)} Crea sessione</button>`,
    });
  }

  function openEditLessonModal(lessonId) {
    const lesson = state.data.lessons.find((item) => item.id === lessonId);
    if (!lesson) {
      return;
    }
    if (!canRescheduleLesson(lesson)) {
      toast(
        "Lezione non modificabile",
        lesson.origin === "course_schedule"
          ? "È generata dal corso: modifica giorno, ora o periodo nelle impostazioni del corso."
          : "Ha già presenze registrate o recuperi collegati. Annullala e crea una nuova data.",
        "warning",
      );
      return;
    }
    const course = courseForLesson(lesson);
    const duration = Math.max(
      15,
      Math.round(
        (new Date(lesson.ends_at) - new Date(lesson.starts_at)) / 60000,
      ),
    );
    openModal({
      title: "Modifica lezione",
      subtitle: `${course?.name || "Corso"} · il cambio sarà visibile alle famiglie`,
      className: "modal--lg",
      body: `
        <form id="edit-lesson-form">
          <input type="hidden" name="lesson_id" value="${escapeHTML(lesson.id)}" />
          <div class="form-grid">
            <div class="field"><label for="edit-lesson-date">Data</label><input class="input" id="edit-lesson-date" name="date" type="date" value="${escapeHTML(dateKey(lesson.starts_at))}" required /></div>
            <div class="field"><label for="edit-lesson-time">Ora di inizio</label><input class="input" id="edit-lesson-time" name="time" type="time" value="${escapeHTML(formatTime(lesson.starts_at))}" required /></div>
            <div class="field"><label for="edit-lesson-duration">Durata (minuti)</label><input class="input" id="edit-lesson-duration" name="duration_minutes" type="number" min="15" max="240" step="5" value="${escapeHTML(duration)}" required /></div>
            <div class="field"><label>Corso</label><input class="input" value="${escapeHTML(course?.name || "—")}" disabled /></div>
            <div class="field field--full"><label for="edit-lesson-title">Titolo</label><input class="input" id="edit-lesson-title" name="title" value="${escapeHTML(lesson.title || course?.name || "")}" required /></div>
            <div class="field field--full"><label for="edit-lesson-location">Sede</label><input class="input" id="edit-lesson-location" name="location" value="${escapeHTML(lesson.location || course?.location || "")}" /></div>
            <div class="field field--full"><label for="edit-lesson-notes">Nota condivisa</label><input class="input" id="edit-lesson-notes" name="notes" value="${escapeHTML(lesson.notes || "")}" placeholder="Visibile alle famiglie iscritte" /></div>
          </div>
        </form>
      `,
      footer: `<button class="btn btn--secondary" type="button" data-action="close-modal">Annulla</button><button class="btn btn--primary" type="submit" form="edit-lesson-form">Salva modifiche</button>`,
    });
  }

  function openCancelLessonModal(lessonId) {
    const lesson = state.data.lessons.find((item) => item.id === lessonId);
    if (!lesson) return;
    openModal({
      title: "Annulla lezione",
      subtitle: `${formatDate(lesson.starts_at)} · ${formatTime(lesson.starts_at)} · ${lesson.title || courseForLesson(lesson)?.name || "Lezione"}`,
      className: "modal--sm",
      body: `
        <form id="cancel-lesson-form">
          <input type="hidden" name="lesson_id" value="${escapeHTML(lesson.id)}" />
          <div class="field">
            <label for="cancel-lesson-status">Motivo</label>
            <select class="select" id="cancel-lesson-status" name="status" required>
              <option value="cancelled_teacher">Annullata dall’insegnante</option>
              <option value="cancelled_other">Altro motivo</option>
            </select>
          </div>
          <div class="field" style="margin-top:14px">
            <label for="cancellation-reason">Messaggio per le famiglie</label>
            <textarea class="textarea" id="cancellation-reason" name="cancellation_reason" rows="4" placeholder="Es. La lezione sarà riprogrammata; seguirà una nuova data." required></textarea>
          </div>
          <div class="info-callout" style="margin-top:16px">${icon("info", 17)}<p>Se è una sessione di recupero, i crediti assegnati torneranno disponibili automaticamente.</p></div>
        </form>
      `,
      footer: `<button class="btn btn--secondary" type="button" data-action="close-modal">Indietro</button><button class="btn btn--danger" type="submit" form="cancel-lesson-form">Annulla lezione</button>`,
    });
  }

  function openLessonDetails(lessonId) {
    const lesson = state.data.lessons.find((item) => item.id === lessonId);
    if (!lesson) return;
    const course = courseForLesson(lesson);
    const students = studentsForLesson(lesson);
    const isRecovery = ["makeup", "recovery"].includes(lesson.lesson_type);
    const managedByCourse = lesson.origin === "course_schedule";
    const recoveryCompletionReady =
      !isRecovery ||
      (students.length > 0 &&
        students.every((student) => {
          const record = attendanceFor(lesson.id, student.id);
          return record && record.status !== "pending";
        }));
    const rescheduleBlocked =
      !isRecovery &&
      !managedByCourse &&
      lesson.status === "scheduled" &&
      !canRescheduleLesson(lesson);
    openModal({
      title: lesson.title || course?.name || "Lezione",
      subtitle: `${formatLongDate(lesson.starts_at)} · ${formatTime(lesson.starts_at)}–${formatTime(lesson.ends_at)}`,
      body: `
        <div class="activity-list">
          <div class="activity-item"><span class="activity-icon">${icon("music", 16)}</span><span class="activity-copy"><strong>${escapeHTML(course?.name || "—")}</strong><span>${escapeHTML(LABELS.lessonType[lesson.lesson_type] || lesson.lesson_type)}</span></span></div>
          <div class="activity-item"><span class="activity-icon">${icon("map", 16)}</span><span class="activity-copy"><strong>${escapeHTML(lesson.location || course?.location || "Studio")}</strong><span>Sede</span></span></div>
          <div class="activity-item"><span class="activity-icon">${icon("users", 16)}</span><span class="activity-copy"><strong>${students.length} ${students.length === 1 ? "allievo" : "allievi"}</strong><span>${escapeHTML(students.map((item) => item.first_name).join(", ") || "Nessun iscritto")}</span></span></div>
        </div>
        <div style="margin-top:16px">${statusBadge("lessonStatus", lesson.status)}</div>
        ${lesson.notes ? `<div class="setting-section"><h3>Nota sulla lezione</h3><p class="muted">${escapeHTML(lesson.notes)}</p></div>` : ""}
        ${lesson.cancellation_reason ? `<div class="setting-section"><h3>Motivo annullamento</h3><p class="muted">${escapeHTML(lesson.cancellation_reason)}</p></div>` : ""}
        ${isRecovery && !recoveryCompletionReady ? `<div class="info-callout" style="margin-top:16px">${icon("info", 17)}<p>Registra la presenza o l’assenza di tutti gli allievi assegnati prima di segnare il recupero come svolto.</p></div>` : ""}
        ${managedByCourse ? `<div class="info-callout" style="margin-top:16px">${icon("repeat", 17)}<p><strong>Generata automaticamente dal corso.</strong> Per cambiare giorno, ora, durata o periodo modifica la programmazione del corso; il calendario futuro si aggiornerà insieme.</p></div>` : ""}
        ${rescheduleBlocked ? `<div class="info-callout" style="margin-top:16px">${icon("info", 17)}<p>Questa lezione ha già presenze o recuperi collegati: per cambiare data, annullala e creane una nuova.</p></div>` : ""}
      `,
      footer: `
        <button class="btn btn--secondary" type="button" data-action="close-modal">Chiudi</button>
        ${
          lesson.status === "scheduled"
            ? `${managedByCourse ? `<button class="btn btn--secondary" type="button" data-action="edit-course" data-course-id="${escapeHTML(course?.id || "")}">${icon("edit", 15)} Modifica corso</button>` : !isRecovery && !rescheduleBlocked ? `<button class="btn btn--secondary" type="button" data-action="edit-lesson" data-lesson-id="${escapeHTML(lesson.id)}">${icon("edit", 15)} Modifica</button>` : ""}<button class="btn btn--danger" type="button" data-action="open-cancel-lesson" data-lesson-id="${escapeHTML(lesson.id)}">Annulla lezione</button>${recoveryCompletionReady ? `<button class="btn btn--primary" type="button" data-action="update-lesson-status" data-lesson-id="${escapeHTML(lesson.id)}" data-status="completed">${icon("checkSimple", 15)} Segna svolta</button>` : ""}`
            : ""
        }
      `,
    });
  }

  function openCourseModal(courseId) {
    const course = courseId
      ? state.data.courses.find((item) => item.id === courseId)
      : null;
    const startsOn = course
      ? course.starts_on || ""
      : state.data.settings.academic_year_start || todayKey();
    const endsOn = course
      ? course.ends_on || ""
      : state.data.settings.academic_year_end || "";
    const defaultWeekday = startsOn
      ? toLocalDate(startsOn).getDay() || 7
      : "";
    const weekday = course ? course.weekday || "" : defaultWeekday;
    const startTime = course ? courseStartTime(course) : "16:30";
    openModal({
      title: course ? `Modifica ${course.name}` : "Nuovo corso",
      subtitle: "Il corso e il suo calendario restano sempre sincronizzati.",
      className: "modal--lg",
      body: `
        <form id="course-form">
          <input type="hidden" name="id" value="${escapeHTML(course?.id || "")}" />
          <div class="form-grid">
            <div class="field field--full"><label for="course-name">Nome del corso</label><input class="input" id="course-name" name="name" value="${escapeHTML(course?.name || "")}" required /></div>
            <div class="field"><label for="course-duration">Durata della lezione (minuti)</label><input class="input" id="course-duration" name="duration_minutes" type="number" min="15" max="240" step="5" value="${escapeHTML(course?.duration_minutes || 50)}" required /></div>
            <div class="field"><label for="course-color">Colore calendario</label><input class="input" id="course-color" name="color" type="color" value="${safeColor(course?.color)}" /></div>
            <div class="field field--full"><label for="course-location">Sede</label><input class="input" id="course-location" name="location" value="${escapeHTML(course?.location || state.data.settings.school_address || "Studio Quarto MoVimento")}" /></div>
          </div>
          <div class="setting-section" style="margin-top:24px;padding-top:24px;border-top:1px solid var(--line)">
            <h3>Programmazione del corso</h3>
            <p>Il gestionale crea una lezione ogni settimana nel periodo indicato. Per un corso senza ricorrenza fissa lascia vuoti tutti e quattro i campi.</p>
            <div class="form-grid">
              <div class="field"><label for="course-starts-on">Inizio corso</label><input class="input" id="course-starts-on" name="starts_on" type="date" value="${escapeHTML(startsOn)}" /></div>
              <div class="field"><label for="course-ends-on">Fine corso</label><input class="input" id="course-ends-on" name="ends_on" type="date" value="${escapeHTML(endsOn)}" /></div>
              <div class="field"><label for="course-weekday">Giorno della lezione</label><select class="select" id="course-weekday" name="weekday"><option value="">Nessun giorno fisso</option>${Object.entries(COURSE_WEEKDAYS)
                .map(
                  ([value, label]) =>
                    `<option value="${value}"${Number(weekday) === Number(value) ? " selected" : ""}>${escapeHTML(label)}</option>`,
                )
                .join("")}</select></div>
              <div class="field"><label for="course-start-time">Ora di inizio</label><input class="input" id="course-start-time" name="start_time" type="time" value="${escapeHTML(startTime)}" /></div>
            </div>
            <div class="info-callout" style="margin-top:16px">${icon("repeat", 17)}<p><strong>Calendario automatico.</strong> Modificando periodo, giorno, ora o durata verranno riallineate tutte le lezioni future generate dal corso. Presenze, recuperi e date aggiunte manualmente non saranno toccati.</p></div>
          </div>
        </form>
      `,
      footer: `${course ? `<button class="btn btn--danger" type="button" data-action="delete-course" data-course-id="${escapeHTML(course.id)}">${icon("trash", 15)} Elimina corso</button>` : ""}<button class="btn btn--secondary" type="button" data-action="close-modal">Annulla</button><button class="btn btn--primary" type="submit" form="course-form">${course ? "Salva e aggiorna calendario" : "Aggiungi e crea calendario"}</button>`,
    });
  }

  function openInvoiceModal() {
    openModal({
      title: "Nuova scadenza",
      subtitle: "Crea una quota, una rata o un’altra voce da pagare.",
      body: `
        <form id="invoice-form">
          <div class="form-grid">
            <div class="field field--full"><label for="invoice-student">Allievo</label><select class="select" id="invoice-student" name="student_id" required><option value="">Scegli l’allievo</option>${state.data.students
              .filter((item) => item.is_active !== false)
              .map(
                (student) =>
                  `<option value="${escapeHTML(student.id)}">${escapeHTML(fullName(student))}</option>`,
              )
              .join("")}</select></div>
            <div class="field field--full"><label for="invoice-title">Voce</label><input class="input" id="invoice-title" name="title" placeholder="Es. Seconda rata abbonamento" required /></div>
            <div class="field field--full"><label for="invoice-description">Descrizione</label><input class="input" id="invoice-description" name="description" placeholder="Facoltativa" /></div>
            <div class="field"><label for="invoice-amount">Importo (€)</label><input class="input" id="invoice-amount" name="amount_eur" type="number" min="0.01" step="0.01" inputmode="decimal" required /></div>
            <div class="field"><label for="invoice-due">Scadenza</label><input class="input" id="invoice-due" name="due_date" type="date" value="${escapeHTML(todayKey())}" required /></div>
            <div class="field field--full"><label for="invoice-number">Numero fattura</label><input class="input" id="invoice-number" name="number" placeholder="Generato automaticamente se lasciato vuoto" /></div>
          </div>
        </form>
      `,
      footer: `<button class="btn btn--secondary" type="button" data-action="close-modal">Annulla</button><button class="btn btn--primary" type="submit" form="invoice-form">Crea scadenza</button>`,
    });
  }

  function openInvoiceDetails(invoiceId) {
    const invoice = state.data.invoices.find((item) => item.id === invoiceId);
    if (!invoice) return;
    const student = studentForInvoice(invoice);
    const family = state.data.families.find(
      (item) => item.id === invoice.family_id,
    );
    const status = invoiceEffectiveStatus(invoice);
    const reminder = paymentReminderForInvoice(invoice.id);
    const canSendReminder = canSendPaymentReminder(invoice);
    const ledger = paymentsForInvoice(invoice.id)
      .filter((item) =>
        ["completed", "partially_refunded", "refunded", "cancelled"].includes(
          item.status,
        ),
      )
      .sort(
        (a, b) =>
          new Date(b.paid_at || b.created_at || 0) -
          new Date(a.paid_at || a.created_at || 0),
      );
    openModal({
      title: invoice.title,
      subtitle: `${invoice.number} · ${fullName(student)}`,
      className: "modal--sm",
      body: `
        <div class="bank-box">
          <div class="bank-box__row"><span>Numero fattura</span><strong>${escapeHTML(invoice.number)}</strong></div>
          <div class="bank-box__row"><span>Importo totale</span><strong>${escapeHTML(formatMoney(invoice.total_cents, invoice.currency))}</strong></div>
          <div class="bank-box__row"><span>Incassato</span><strong>${escapeHTML(formatMoney(invoicePaidCents(invoice), invoice.currency))}</strong></div>
          <div class="bank-box__row"><span>Da incassare</span><strong>${escapeHTML(formatMoney(invoiceOutstandingCents(invoice), invoice.currency))} ${statusBadge("invoice", invoicePaymentStatus(invoice))}</strong></div>
          <div class="bank-box__row"><span>Scadenza</span><strong>${escapeHTML(formatDate(invoice.due_date))}</strong></div>
        </div>
        ${status === "void" ? `<div class="info-callout" style="margin-top:16px">${icon("info", 17)}<p><strong>Scadenza annullata.</strong> ${escapeHTML(invoice.void_reason || "")}${invoice.voided_at ? ` · ${escapeHTML(formatDate(invoice.voided_at))}` : ""}</p></div>` : ""}
        ${reminder ? `<div class="info-callout" style="margin-top:16px">${icon("bell", 17)}<p><strong>Promemoria inviato alla famiglia il ${escapeHTML(formatDate(reminder.sent_at || reminder.created_at))}.</strong> Resterà visibile finché la quota risulta insoluta.</p></div>` : ""}
        <div class="activity-list" style="margin-top:16px">
          <div class="activity-item"><span class="activity-icon">${icon("users", 16)}</span><span class="activity-copy"><strong>${escapeHTML(family?.display_name || "—")}</strong><span>${escapeHTML(family?.email || "")}</span></span></div>
          <div class="activity-item"><span class="activity-icon">${icon("receipt", 16)}</span><span class="activity-copy"><strong>${escapeHTML(invoice.description || invoice.title)}</strong><span>${invoice.paid_at ? `Pagato il ${escapeHTML(formatDate(invoice.paid_at))}` : "In attesa di pagamento"}</span></span></div>
        </div>
        ${
          ledger.length
            ? `<div class="setting-section"><h3>Movimenti registrati</h3><div class="activity-list">${ledger
                .map((payment) => {
                  const net =
                    Number(payment.amount_cents || 0) -
                    Number(payment.refunded_cents || 0);
                  const cancellation =
                    payment.metadata?.cancelled_by_admin || null;
                  return `<div class="activity-item"><span class="activity-icon">${icon("wallet", 16)}</span><span class="activity-copy"><strong>${escapeHTML(formatMoney(net, payment.currency))} · ${escapeHTML(paymentMethodLabel(payment.method))}${payment.status === "cancelled" ? " · annullato" : ""}</strong><span>${escapeHTML(formatDate(payment.paid_at || payment.created_at))}${payment.reference ? ` · ${escapeHTML(payment.reference)}` : ""}${cancellation?.reason ? ` · ${escapeHTML(cancellation.reason)}` : ""}</span></span>${payment.provider === "manual" && payment.status === "completed" ? `<button class="row-action" type="button" data-action="open-cancel-payment" data-payment-id="${escapeHTML(payment.id)}" aria-label="Annulla incasso">${icon("trash", 16)}</button>` : ""}</div>`;
                })
                .join("")}</div></div>`
            : ""
        }
      `,
      footer: `<button class="btn btn--secondary" type="button" data-action="close-modal">Chiudi</button>${canSendReminder ? `<button class="btn btn--secondary" type="button" data-action="open-payment-reminder" data-invoice-id="${escapeHTML(invoice.id)}">${icon("bell", 15)} Invia notifica</button>` : ""}${invoiceCanBeVoided(invoice) ? `<button class="btn btn--danger" type="button" data-action="open-void-invoice" data-invoice-id="${escapeHTML(invoice.id)}">${icon("trash", 15)} Elimina scadenza</button>` : ""}${!["paid", "processing", "void"].includes(status) ? `<button class="btn btn--primary" type="button" data-action="mark-invoice-paid" data-invoice-id="${escapeHTML(invoice.id)}">${icon("checkSimple", 15)} Segna pagato</button>` : ""}`,
    });
  }

  function openPaymentReminderModal(invoiceId) {
    const invoice = state.data.invoices.find((item) => item.id === invoiceId);
    if (!invoice || !canSendPaymentReminder(invoice)) return;
    const student = studentForInvoice(invoice);
    const family = state.data.families.find(
      (item) => item.id === invoice.family_id,
    );
    const linkedEmails = familyLinkedAccessEmails(family);
    openModal({
      title: "Invia promemoria di pagamento",
      subtitle: `${invoice.number} · ${fullName(student)}`,
      className: "modal--sm",
      body: `
        <form id="payment-reminder-form">
          <input type="hidden" name="invoice_id" value="${escapeHTML(invoice.id)}" />
          <div class="info-callout">${icon("bell", 17)}<p>La notifica comparirà nell’area della famiglia. Non invia un’e-mail o un messaggio WhatsApp e non permette risposte interne.</p></div>
          <div class="bank-box" style="margin-top:16px">
            <div class="bank-box__row"><span>Famiglia</span><strong>${escapeHTML(family?.display_name || "—")}</strong></div>
            <div class="bank-box__row"><span>Account collegati</span><strong>${escapeHTML(linkedEmails.join(", ") || "Nessuno")}</strong></div>
            <div class="bank-box__row"><span>Scadenza</span><strong>${escapeHTML(formatDate(invoice.due_date))}</strong></div>
            <div class="bank-box__row"><span>Saldo insoluto</span><strong>${escapeHTML(formatMoney(invoiceOutstandingCents(invoice), invoice.currency))}</strong></div>
          </div>
          <p class="muted" style="font-size:12px;margin-top:14px">Per questa fattura potrà essere inviato un solo promemoria. L’avviso sparirà dall’area famiglia quando il saldo verrà registrato.</p>
        </form>
      `,
      footer: `<button class="btn btn--secondary" type="button" data-action="close-modal">Annulla</button><button class="btn btn--primary" type="submit" form="payment-reminder-form">${icon("bell", 15)} Invia notifica</button>`,
    });
  }

  function openVoidInvoiceModal(invoiceId) {
    const invoice = state.data.invoices.find((item) => item.id === invoiceId);
    if (!invoice || !invoiceCanBeVoided(invoice)) return;
    openModal({
      title: "Elimina scadenza",
      subtitle: `${invoice.number} · ${invoice.title}`,
      className: "modal--sm",
      body: `
        <form id="void-invoice-form">
          <input type="hidden" name="invoice_id" value="${escapeHTML(invoice.id)}" />
          <div class="info-callout">${icon("info", 17)}<p>La scadenza verrà annullata e nascosta alle famiglie, conservando lo storico contabile. Se contiene un incasso, annulla prima quel movimento.</p></div>
          <div class="field" style="margin-top:16px"><label for="void-invoice-reason">Motivo</label><textarea class="textarea" id="void-invoice-reason" name="reason" rows="3" maxlength="500" placeholder="Es. Scadenza inserita per errore" required></textarea></div>
        </form>
      `,
      footer: `<button class="btn btn--secondary" type="button" data-action="close-modal">Torna indietro</button><button class="btn btn--danger" type="submit" form="void-invoice-form">${icon("trash", 15)} Elimina scadenza</button>`,
    });
  }

  function openCancelManualPaymentModal(paymentId) {
    const payment = state.data.payments.find((item) => item.id === paymentId);
    if (!payment || payment.provider !== "manual" || payment.status !== "completed") {
      return;
    }
    const invoice = state.data.invoices.find(
      (item) => item.id === payment.invoice_id,
    );
    openModal({
      title: "Annulla incasso",
      subtitle: `${invoice?.number || "Scadenza"} · ${formatMoney(payment.amount_cents, payment.currency)}`,
      className: "modal--sm",
      body: `
        <form id="cancel-payment-form">
          <input type="hidden" name="payment_id" value="${escapeHTML(payment.id)}" />
          <div class="info-callout">${icon("info", 17)}<p>Il movimento non verrà cancellato fisicamente: sarà stornato e resterà visibile nello storico. I pagamenti PayPal si gestiscono dal provider.</p></div>
          <div class="field" style="margin-top:16px"><label for="cancel-payment-reason">Motivo</label><textarea class="textarea" id="cancel-payment-reason" name="reason" rows="3" maxlength="500" placeholder="Es. Incasso registrato due volte" required></textarea></div>
        </form>
      `,
      footer: `<button class="btn btn--secondary" type="button" data-action="close-modal">Torna indietro</button><button class="btn btn--danger" type="submit" form="cancel-payment-form">${icon("trash", 15)} Annulla incasso</button>`,
    });
  }

  function openMarkInvoicePaid(invoiceId) {
    const invoice = state.data.invoices.find((item) => item.id === invoiceId);
    if (!invoice) return;
    openModal({
      title: "Conferma pagamento",
      subtitle: `${invoice.number} · ${formatMoney(invoiceOutstandingCents(invoice), invoice.currency)} da incassare`,
      className: "modal--sm",
      body: `
        <form id="mark-paid-form">
          <input type="hidden" name="invoice_id" value="${escapeHTML(invoice.id)}" />
          <div class="field"><label for="paid-method">Metodo ricevuto</label><select class="select" id="paid-method" name="method"><option value="bank_transfer">Bonifico</option><option value="paypal">PayPal</option><option value="cash">Contanti</option></select></div>
          <div class="field" style="margin-top:14px"><label for="paid-date">Data del pagamento</label><input class="input" id="paid-date" name="paid_on" type="date" value="${escapeHTML(todayKey())}" max="${escapeHTML(todayKey())}" required /><p class="field-hint">Indica il giorno in cui il denaro è stato incassato.</p></div>
          <div class="info-callout" style="margin-top:16px">${icon("info", 17)}<p>Usa questa conferma solo dopo aver verificato che il denaro sia stato effettivamente ricevuto.</p></div>
        </form>
      `,
      footer: `<button class="btn btn--secondary" type="button" data-action="close-modal">Annulla</button><button class="btn btn--primary" type="submit" form="mark-paid-form">Conferma incasso</button>`,
    });
  }

  let paypalSdkPromise = null;

  function loadPayPalSdk() {
    if (window.paypal) return Promise.resolve(window.paypal);
    if (paypalSdkPromise) return paypalSdkPromise;
    paypalSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const currency = encodeURIComponent(config.paypalCurrency || "EUR");
      script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=${currency}&intent=capture&components=buttons`;
      script.async = true;
      script.onload = () => resolve(window.paypal);
      script.onerror = () =>
        reject(new Error("Non è stato possibile caricare PayPal."));
      document.head.appendChild(script);
    });
    return paypalSdkPromise;
  }

  async function mountPayPalButton(invoice) {
    const container = document.getElementById("paypal-button-container");
    if (!container || !config.paypalClientId) return;
    try {
      const paypal = await loadPayPalSdk();
      if (!container.isConnected) return;
      await paypal
        .Buttons({
          style: {
            layout: "vertical",
            color: "gold",
            shape: "rect",
            label: "paypal",
          },
          createOrder: async () => {
            const result = await state.store.createPayPalOrder(invoice.id);
            const orderId = result.orderID || result.order_id || result.id;
            if (!orderId) throw new Error("PayPal non ha restituito un ordine.");
            return orderId;
          },
          onApprove: async (data) => {
            const result = await state.store.capturePayPalOrder(
              invoice.id,
              data.orderID,
            );
            const captureStatus =
              result.status ||
              result.capture?.status ||
              result.purchase_units?.[0]?.payments?.captures?.[0]?.status;
            if (captureStatus && captureStatus !== "COMPLETED") {
              throw new Error(
                "Il pagamento è in elaborazione. Lo stato sarà aggiornato appena confermato.",
              );
            }
            await refreshData();
            closeModal();
            toast(
              "Pagamento completato",
              "Grazie! La quota risulta ora pagata.",
            );
          },
          onCancel: () => {
            toast(
              "Pagamento annullato",
              "Non è stato effettuato alcun addebito.",
              "error",
            );
          },
          onError: (error) => {
            console.error(error);
            toast(
              "PayPal non disponibile",
              error?.message || "Riprova tra poco o usa il bonifico.",
              "error",
            );
          },
        })
        .render(container);
    } catch (error) {
      container.innerHTML = `<div class="info-callout">${icon("alert", 17)}<p>${escapeHTML(error.message || "PayPal non disponibile. Puoi usare il bonifico.")}</p></div>`;
    }
  }

  function openPaymentModal(invoiceId) {
    const invoice = state.data.invoices.find((item) => item.id === invoiceId);
    if (!invoice) return;
    const student = studentForInvoice(invoice);
    openModal({
      title: `Paga ${formatMoney(invoiceOutstandingCents(invoice), invoice.currency)}`,
      subtitle: `${invoice.title} · ${fullName(student)}`,
      className: "modal--lg",
      body: `
        <div class="grid grid--two">
          <section>
            <h3 style="font-size:15px;margin-bottom:5px">Paga con PayPal</h3>
            <p class="muted" style="font-size:11px;margin-bottom:15px">Apri il profilo ufficiale Quarto MoVimento e indica l’importo qui mostrato. Non memorizziamo i dati della carta.</p>
            <a class="btn btn--yellow" style="width:100%;margin-bottom:12px" href="${PAYPAL_ME_URL}" target="_blank" rel="noopener noreferrer">${icon("card", 16)} Paga con PayPal</a>
            ${
              state.mode === "demo"
                ? `<button class="btn btn--secondary" style="width:100%" type="button" data-action="simulate-paypal" data-invoice-id="${escapeHTML(invoice.id)}">Simula conferma automatica</button><p class="subtle" style="font-size:10px;margin-top:9px">In anteprima non viene eseguito alcun addebito.</p>`
                : config.paypalClientId
                  ? `<div id="paypal-button-container"></div>`
                  : `<div class="info-callout">${icon("info", 17)}<p>Dopo il pagamento, Valeria aggiornerà lo stato della quota. Per qualsiasi dubbio usa “Parlane con Valeria” su WhatsApp.</p></div>`
            }
          </section>
          <section>
            <h3 style="font-size:15px;margin-bottom:5px">Oppure fai un bonifico</h3>
            <p class="muted" style="font-size:11px;margin-bottom:15px">La causale deve riportare, in quest’ordine: <strong>nome, cognome, numero fattura</strong>. Puoi copiare quella già compilata qui sotto.</p>
            ${bankDetails(invoice)}
          </section>
        </div>
      `,
      footer: `<button class="btn btn--primary" type="button" data-action="close-modal">Chiudi</button>`,
    });
    if (
      state.mode === "production" &&
      config.paypalClientId &&
      invoiceEffectiveStatus(invoice) !== "paid"
    ) {
      window.setTimeout(() => mountPayPalButton(invoice), 30);
    }
  }

  function openSetPasswordModal() {
    openModal({
      title: "Scegli una password",
      subtitle: "Completa l’attivazione del tuo accesso.",
      className: "modal--sm",
      body: `
        <form id="set-password-form">
          <div class="field"><label for="new-password">Nuova password</label><input class="input" id="new-password" name="password" type="password" autocomplete="new-password" minlength="12" required /><p class="field-hint">Almeno 12 caratteri, con maiuscola, minuscola, numero e simbolo.</p></div>
          <div class="field" style="margin-top:14px"><label for="new-password-confirm">Ripeti la password</label><input class="input" id="new-password-confirm" name="confirm_password" type="password" autocomplete="new-password" minlength="12" required /></div>
        </form>
      `,
      footer: `<button class="btn btn--primary" style="width:100%" type="submit" form="set-password-form">Salva password e continua</button>`,
    });
  }

  function toDateTimeLocal(value) {
    const date = value ? new Date(value) : new Date();
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function openExcusedAbsenceModal(lessonId, studentId) {
    const lesson = state.data.lessons.find((item) => item.id === lessonId);
    const student = state.data.students.find((item) => item.id === studentId);
    if (!lesson || !student) return;
    const current = attendanceFor(lessonId, studentId);
    const enrollment = enrollmentForLessonStudent(studentId, lesson);
    const noticeHours = recoveryNoticeHoursForEnrollment(enrollment);
    openModal({
      title: `Assenza avvisata · ${fullName(student)}`,
      subtitle: `Lezione del ${formatDate(lesson.starts_at)} alle ${formatTime(lesson.starts_at)}`,
      className: "modal--sm",
      body: `
        <form id="excused-absence-form">
          <input type="hidden" name="lesson_id" value="${escapeHTML(lessonId)}" />
          <input type="hidden" name="student_id" value="${escapeHTML(studentId)}" />
          <div class="field">
            <label for="absence-notified-at">Quando è stata comunicata?</label>
            <input class="input" id="absence-notified-at" name="absence_notified_at" type="datetime-local" value="${escapeHTML(toDateTimeLocal(current?.absence_notified_at))}" required />
            <p class="field-hint">Serve per verificare automaticamente il preavviso di ${escapeHTML(noticeHours)} ore e l’eventuale recupero previsto dall’iscrizione.</p>
          </div>
        </form>
      `,
      footer: `<button class="btn btn--secondary" type="button" data-action="close-modal">Annulla</button><button class="btn btn--primary" type="submit" form="excused-absence-form">Registra assenza</button>`,
    });
  }

  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function refreshData(render) {
    state.data = await state.store.loadData(state.role);
    if (!Array.isArray(state.data.schoolClosures)) {
      state.data.schoolClosures = [];
    }
    state.lastDataRefreshAt = Date.now();
    if (
      state.selectedStudentId &&
      !state.data.students.some((item) => item.id === state.selectedStudentId)
    ) {
      state.selectedStudentId = null;
    }
    if (!state.selectedStudentId && state.role === ROLE_FAMILY) {
      state.selectedStudentId = state.data.students[0]?.id || null;
    }
    if (render !== false) renderShell();
  }

  let paymentReminderRealtimeRefreshInFlight = false;

  async function stopPaymentReminderRealtime() {
    const channel = state.paymentReminderChannel;
    state.paymentReminderChannel = null;
    paymentReminderRealtimeRefreshInFlight = false;
    if (!channel || !state.supabase) return;
    try {
      await state.supabase.removeChannel(channel);
    } catch (error) {
      console.warn("Chiusura aggiornamenti promemoria non riuscita:", error);
    }
  }

  function startPaymentReminderRealtime() {
    if (
      state.mode !== "production" ||
      state.role !== ROLE_FAMILY ||
      !state.user ||
      !state.supabase ||
      state.data?.paymentRemindersAvailable === false ||
      state.paymentReminderChannel
    ) {
      return;
    }

    const channel = state.supabase.channel(
      `payment-reminders:${state.user.id}`,
    );
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "payment_reminders" },
      async (payload) => {
        if (
          state.paymentReminderChannel !== channel ||
          paymentReminderRealtimeRefreshInFlight
        ) {
          return;
        }
        paymentReminderRealtimeRefreshInFlight = true;
        try {
          await refreshData();
          if (paymentReminderForInvoice(payload.new?.invoice_id)) {
            toast(
              "Nuovo promemoria di pagamento",
              "Controlla la quota nella Home o nella sezione Pagamenti.",
            );
          }
        } catch (error) {
          console.warn("Aggiornamento promemoria non riuscito:", error);
        } finally {
          paymentReminderRealtimeRefreshInFlight = false;
        }
      },
    );
    state.paymentReminderChannel = channel;
    channel.subscribe((status) => {
      if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
        console.warn("Aggiornamenti promemoria non disponibili:", status);
      }
    });
  }

  let attendanceEffectsTimer = null;
  function scheduleAttendanceEffectsRefresh() {
    window.clearTimeout(attendanceEffectsTimer);
    attendanceEffectsTimer = window.setTimeout(async () => {
      try {
        state.data.makeupCredits = await state.store.loadMakeupCredits();
      } catch (error) {
        console.warn("Riconciliazione recuperi non riuscita:", error);
      }
    }, 500);
  }

  function authRedirectUrl(action) {
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = new URL(base);
    url.searchParams.set("auth_action", action || "magic-link");
    return url.toString();
  }

  function replaceAppRoute(hash, clearAuthParams) {
    const url = new URL(window.location.href);
    if (clearAuthParams) {
      [
        "auth_action",
        "code",
        "token",
        "token_hash",
        "type",
        "error",
        "error_code",
        "error_description",
      ].forEach((key) => url.searchParams.delete(key));
    }
    url.hash = hash;
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  let authEmailCooldownTimer = null;
  let authEmailCooldownMemoryUntil = 0;

  function authEmailCooldownUntil() {
    let storedUntil = 0;
    try {
      const value = Number(
        window.localStorage.getItem(AUTH_EMAIL_COOLDOWN_KEY) || 0,
      );
      storedUntil = Number.isFinite(value) ? value : 0;
    } catch {
      storedUntil = 0;
    }
    return Math.max(storedUntil, authEmailCooldownMemoryUntil);
  }

  function authEmailCooldownSeconds() {
    return Math.max(
      0,
      Math.ceil((authEmailCooldownUntil() - Date.now()) / 1000),
    );
  }

  function setAuthEmailCooldown(duration) {
    const until = Date.now() + Math.max(1000, Number(duration) || 0);
    authEmailCooldownMemoryUntil = until;
    try {
      window.localStorage.setItem(AUTH_EMAIL_COOLDOWN_KEY, String(until));
    } catch {
      // Il blocco resta comunque attivo nella pagina corrente tramite il timer.
    }
    syncAuthEmailCooldown(until);
    return until;
  }

  function clearAuthEmailCooldown(expectedUntil) {
    if (
      !expectedUntil ||
      authEmailCooldownMemoryUntil === Number(expectedUntil)
    ) {
      authEmailCooldownMemoryUntil = 0;
    }
    try {
      const storedUntil = Number(
        window.localStorage.getItem(AUTH_EMAIL_COOLDOWN_KEY) || 0,
      );
      if (!expectedUntil || storedUntil === Number(expectedUntil)) {
        window.localStorage.removeItem(AUTH_EMAIL_COOLDOWN_KEY);
      }
    } catch {
      // Nessuna azione necessaria se lo storage non è disponibile.
    }
    syncAuthEmailCooldown(0);
  }

  function syncAuthEmailCooldown(forcedUntil) {
    window.clearTimeout(authEmailCooldownTimer);
    const until = Math.max(
      Number(forcedUntil) || 0,
      authEmailCooldownUntil(),
    );
    const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    const magicLinkButton = document.getElementById("magic-link-button");
    const resetButton = document.querySelector(
      '[data-action="forgot-password"]',
    );
    const status = document.getElementById("auth-email-status");

    if (seconds > 0) {
      if (magicLinkButton && !magicLinkButton.dataset.originalHtml) {
        magicLinkButton.disabled = true;
        magicLinkButton.textContent = `Link già richiesto · ${seconds}s`;
      }
      if (resetButton && !resetButton.dataset.originalHtml) {
        resetButton.disabled = true;
        resetButton.textContent = `Nuovo invio tra ${seconds}s`;
      }
      if (status) {
        status.textContent =
          `Usa l’ultima e-mail ricevuta. Un nuovo invio sarà disponibile tra ${seconds} secondi.`;
      }
      authEmailCooldownTimer = window.setTimeout(
        () => syncAuthEmailCooldown(until),
        1000,
      );
      return;
    }

    authEmailCooldownMemoryUntil = 0;
    try {
      window.localStorage.removeItem(AUTH_EMAIL_COOLDOWN_KEY);
    } catch {
      // Nessuna azione necessaria se lo storage non è disponibile.
    }
    if (magicLinkButton && !magicLinkButton.dataset.originalHtml) {
      magicLinkButton.disabled = false;
      magicLinkButton.textContent = "Ricevi un link via e-mail";
    }
    if (resetButton && !resetButton.dataset.originalHtml) {
      resetButton.disabled = false;
      resetButton.textContent = "Password dimenticata?";
    }
    if (status) {
      status.textContent =
        "Dopo l’invio attendi 60 secondi prima di richiedere un nuovo link.";
    }
  }

  function isAuthRateLimitError(error) {
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "");
    return (
      Number(error?.status || 0) === 429 ||
      [
        "over_email_send_rate_limit",
        "over_request_rate_limit",
        "email_rate_limit_exceeded",
      ].includes(code) ||
      /(?:(?:email|request)\s+)?rate limit (?:exceeded|reached)|too many (?:emails?|requests?)/i.test(
        message,
      )
    );
  }

  function showAuthEmailCooldownMessage() {
    const seconds = authEmailCooldownSeconds();
    toast(
      "Link già richiesto",
      seconds > 0
        ? `Usa l’ultima e-mail ricevuta oppure accedi con la password. Potrai fare un nuovo invio tra ${seconds} secondi.`
        : "Usa l’ultima e-mail ricevuta oppure accedi con la password.",
    );
  }

  async function sendMagicLink() {
    if (state.mode !== "production") {
      toast(
        "Anteprima locale",
        "I link e-mail saranno disponibili dopo la configurazione Supabase.",
        "error",
      );
      return;
    }
    const emailInput = document.getElementById("login-email");
    const email = emailInput?.value.trim().toLowerCase();
    if (!email) {
      emailInput?.focus();
      toast("Inserisci l’e-mail", "Serve per inviarti il link di accesso.", "error");
      return;
    }
    const button = document.querySelector('[data-action="magic-link"]');
    if (authEmailCooldownSeconds() > 0) {
      syncAuthEmailCooldown();
      showAuthEmailCooldownMessage();
      return;
    }
    setButtonLoading(button, true, "Invio…");
    const requestCooldownUntil = setAuthEmailCooldown(AUTH_EMAIL_COOLDOWN_MS);
    try {
      const { error } = await state.supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: authRedirectUrl("magic-link"),
        },
      });
      if (error) throw error;
      toast(
        "Controlla la posta",
        "Ti abbiamo inviato un link di accesso. Usa l’ultima e-mail ricevuta e controlla anche lo spam.",
      );
    } catch (error) {
      if (isAuthRateLimitError(error)) {
        setAuthEmailCooldown(AUTH_EMAIL_RATE_LIMIT_COOLDOWN_MS);
        toast(
          "Link già richiesto di recente",
          "Il servizio e-mail ha raggiunto temporaneamente il limite di invio. Usa l’ultimo link ricevuto oppure accedi con la password; il gestionale non ripeterà automaticamente la richiesta.",
        );
      } else {
        clearAuthEmailCooldown(requestCooldownUntil);
        toast(
          "Link non inviato",
          error.message || "Controlla l’indirizzo e riprova.",
          "error",
        );
      }
    } finally {
      setButtonLoading(button, false);
      syncAuthEmailCooldown();
    }
  }

  async function sendPasswordReset() {
    if (state.mode !== "production") {
      toast(
        "Anteprima locale",
        "Il recupero password sarà disponibile con Supabase configurato.",
        "error",
      );
      return;
    }
    const emailInput = document.getElementById("login-email");
    const email = emailInput?.value.trim().toLowerCase();
    if (!email) {
      emailInput?.focus();
      toast(
        "Inserisci l’e-mail",
        "Poi richiedi di nuovo il recupero password.",
        "error",
      );
      return;
    }
    const button = document.querySelector('[data-action="forgot-password"]');
    if (authEmailCooldownSeconds() > 0) {
      syncAuthEmailCooldown();
      showAuthEmailCooldownMessage();
      return;
    }
    setButtonLoading(button, true, "Invio…");
    const requestCooldownUntil = setAuthEmailCooldown(AUTH_EMAIL_COOLDOWN_MS);
    try {
      const { error } = await state.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authRedirectUrl("set-password"),
      });
      if (error) throw error;
      toast(
        "E-mail inviata",
        "Apri il link ricevuto per scegliere una nuova password.",
      );
    } catch (error) {
      if (isAuthRateLimitError(error)) {
        setAuthEmailCooldown(AUTH_EMAIL_RATE_LIMIT_COOLDOWN_MS);
        toast(
          "Recupero già richiesto",
          "Il servizio e-mail ha raggiunto temporaneamente il limite di invio. Usa l’ultima e-mail ricevuta oppure accedi con la password.",
        );
      } else {
        clearAuthEmailCooldown(requestCooldownUntil);
        toast(
          "Recupero non avviato",
          error.message || "Riprova tra poco.",
          "error",
        );
      }
    } finally {
      setButtonLoading(button, false);
      syncAuthEmailCooldown();
    }
  }

  async function loginWithPassword(form, button) {
    if (state.mode !== "production") return;
    const values = formValues(form);
    setButtonLoading(button, true, "Accesso…");
    try {
      const { data, error } = await state.supabase.auth.signInWithPassword({
        email: String(values.email || "").trim(),
        password: values.password,
      });
      if (error) throw error;
      if (!data.session) throw new Error("Accesso non completato.");
      await loadAuthenticatedUser(data.user);
    } catch (error) {
      const rateLimited = isAuthRateLimitError(error);
      toast(
        rateLimited ? "Troppi tentativi di accesso" : "Accesso non riuscito",
        rateLimited
          ? "Attendi qualche minuto prima di riprovare."
          : /invalid login credentials/i.test(error.message || "")
            ? "E-mail o password non corrette."
            : error.message || "Riprova tra poco.",
        "error",
      );
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function loginDemo(role) {
    state.user = {
      id: role === ROLE_ADMIN ? "demo-admin" : "demo-family",
      email:
        role === ROLE_ADMIN
          ? "valeria@quartomovimento.it"
          : "giulia.bianchi@example.com",
    };
    state.profile = {
      role,
      display_name: role === ROLE_ADMIN ? "Valeria" : "Giulia Bianchi",
    };
    state.role = role;
    state.store = new DemoStore();
    await refreshData(false);
    state.selectedStudentId =
      role === ROLE_FAMILY ? state.data.students[0]?.id || null : null;
    const validPrefix = role === ROLE_ADMIN ? "#/admin/" : "#/famiglia/";
    const defaultHash =
      role === ROLE_ADMIN ? "#/admin/overview" : "#/famiglia/home";
    window.history.replaceState(
      null,
      "",
      window.location.hash.startsWith(validPrefix)
        ? window.location.hash
        : defaultHash,
    );
    renderShell();
  }

  function renderAccessPending(inactive) {
    appRoot.innerHTML = `
      <main class="login-page" id="main-content">
        <section class="login-panel" style="grid-column:1/-1;align-items:center;justify-content:center">
          <div class="card empty-state" style="width:min(100%,520px)">
            <span class="empty-state__icon">${icon("mail", 24)}</span>
            <h1 style="font-size:24px">${inactive ? "Account disattivato" : "Accesso da completare"}</h1>
            <p>${inactive ? "Questo profilo non è attivo. Contatta Quarto MoVimento se pensi si tratti di un errore." : "Il tuo account è autenticato, ma non è ancora associato a una famiglia o al ruolo amministratore. Contatta Quarto MoVimento."}</p>
            <div class="support-actions" style="justify-content:center">
              <a class="btn btn--primary" href="${WHATSAPP_URL}" target="_blank" rel="noopener noreferrer">Parlane con Valeria</a>
              <a class="btn btn--secondary" href="${TIDYCAL_URL}" target="_blank" rel="noopener noreferrer">Fissa un colloquio</a>
              <button class="btn btn--secondary" type="button" data-action="logout">Esci</button>
            </div>
          </div>
        </section>
      </main>
    `;
  }

  function renderFatalError(error) {
    console.error(error);
    appRoot.innerHTML = `
      <main class="login-page" id="main-content">
        <section class="login-panel" style="grid-column:1/-1;align-items:center;justify-content:center">
          <div class="card empty-state" style="width:min(100%,560px)">
            <span class="empty-state__icon" style="color:var(--danger);background:var(--danger-bg)">${icon("alert", 24)}</span>
            <h1 style="font-size:24px">Non riusciamo a caricare l’area corsi</h1>
            <p>${escapeHTML(error?.message || "Controlla la connessione e riprova.")}</p>
            <button class="btn btn--primary" type="button" data-action="reload-page">Riprova</button>
          </div>
        </section>
      </main>
    `;
  }

  async function loadAuthenticatedUser(user, setPassword) {
    try {
      state.user = user;
      state.profile = await state.store.loadProfile(user.id);
      if (!state.profile) {
        await stopPaymentReminderRealtime();
        state.role = null;
        renderAccessPending();
        return;
      }
      if (state.profile.is_active === false) {
        await stopPaymentReminderRealtime();
        state.role = null;
        renderAccessPending(true);
        return;
      }
      state.role = state.profile.role;
      if (![ROLE_ADMIN, ROLE_FAMILY].includes(state.role)) {
        await stopPaymentReminderRealtime();
        state.role = null;
        renderAccessPending();
        return;
      }
      await refreshData(false);
      state.selectedStudentId =
        state.role === ROLE_FAMILY
          ? state.selectedStudentId || state.data.students[0]?.id || null
          : null;

      const needsPassword =
        setPassword ||
        window.location.hash === "#/set-password" ||
        new URLSearchParams(window.location.search).get("auth_action") ===
          "set-password";
      const prefix = state.role === ROLE_ADMIN ? "admin" : "famiglia";
      const defaultRoute = state.role === ROLE_ADMIN ? "overview" : "home";
      const current = window.location.hash;
      if (needsPassword) {
        replaceAppRoute("#/set-password", false);
      } else if (!current.startsWith(`#/${prefix}/`)) {
        replaceAppRoute(`#/${prefix}/${defaultRoute}`, true);
      } else if (
        new URLSearchParams(window.location.search).has("auth_action")
      ) {
        replaceAppRoute(current, true);
      }
      renderShell();
      if (state.role === ROLE_FAMILY) {
        startPaymentReminderRealtime();
      } else {
        await stopPaymentReminderRealtime();
      }
      if (needsPassword) openSetPasswordModal();
    } catch (error) {
      renderFatalError(error);
    }
  }

  async function logout() {
    closeModal();
    await stopPaymentReminderRealtime();
    if (state.mode === "production" && state.supabase) {
      await state.supabase.auth.signOut();
    }
    state.user = null;
    state.profile = null;
    state.role = null;
    state.data = null;
    state.familyAccountStatuses = {};
    state.selectedStudentId = null;
    state.store =
      state.mode === "demo" ? new DemoStore() : new SupabaseStore(state.supabase);
    replaceAppRoute("#/login", true);
    renderLogin();
  }

  function escapeIcs(value) {
    return String(value || "")
      .replaceAll("\\", "\\\\")
      .replaceAll("\n", "\\n")
      .replaceAll(",", "\\,")
      .replaceAll(";", "\\;");
  }

  function icsDate(value) {
    return new Date(value)
      .toISOString()
      .replaceAll("-", "")
      .replaceAll(":", "")
      .replace(/\.\d{3}Z$/, "Z");
  }

  function icsDateOnly(value) {
    return String(value || "").replaceAll("-", "");
  }

  function downloadStudentCalendar(studentId) {
    const student = state.data.students.find((item) => item.id === studentId);
    if (!student) return;
    const events = lessonsForStudent(studentId).filter(
      (item) =>
        new Date(item.ends_at) >= new Date() &&
        !String(item.status).startsWith("cancelled") &&
        !lessonIsOnSchoolClosure(item),
    );
    const closures = schoolClosuresForStudent(studentId).filter(
      (closure) => closure.closure_date >= todayKey(),
    );
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Quarto MoVimento//Area corsi//IT",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeIcs(`Quarto MoVimento · ${student.first_name}`)}`,
      "X-WR-TIMEZONE:Europe/Rome",
      ...events.flatMap((lesson) => {
        const course = courseForLesson(lesson);
        return [
          "BEGIN:VEVENT",
          `UID:${escapeIcs(lesson.id)}@quartomovimento.it`,
          `DTSTAMP:${icsDate(new Date())}`,
          `DTSTART:${icsDate(lesson.starts_at)}`,
          `DTEND:${icsDate(lesson.ends_at)}`,
          `SUMMARY:${escapeIcs(lesson.title || course?.name || "Lezione di musica")}`,
          `LOCATION:${escapeIcs(lesson.location || course?.location || state.data.settings.school_address || "")}`,
          `DESCRIPTION:${escapeIcs(LABELS.lessonType[lesson.lesson_type] || "Lezione")}`,
          "END:VEVENT",
        ];
      }),
      ...closures.flatMap((closure) => [
        "BEGIN:VEVENT",
        `UID:school-closure-${escapeIcs(closure.id)}@quartomovimento.it`,
        `DTSTAMP:${icsDate(new Date())}`,
        `DTSTART;VALUE=DATE:${icsDateOnly(closure.closure_date)}`,
        `DTEND;VALUE=DATE:${icsDateOnly(dateKey(addDays(closure.closure_date, 1)))}`,
        `SUMMARY:${escapeIcs(SCHOOL_CLOSURE_TITLE)}`,
        `DESCRIPTION:${escapeIcs(schoolClosureFamilyDescription(closure))}`,
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
      ]),
      "END:VCALENDAR",
    ];
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `quarto-movimento-${student.first_name.toLowerCase()}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast(
      "Calendario scaricato",
      "Apri il file .ics per aggiungere lezioni e chiusure al tuo calendario.",
    );
  }

  async function copyTextToClipboard(value) {
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        return document.execCommand("copy");
      } finally {
        textarea.remove();
      }
    }
  }

  async function copyValue(value) {
    const copied = await copyTextToClipboard(value);
    toast(
      copied ? "Copiato" : "Copia non riuscita",
      copied
        ? "Ora puoi incollare il dato dove ti serve."
        : "Seleziona il testo e copialo manualmente.",
      copied ? "success" : "error",
    );
    return copied;
  }

  async function copyInvitationLink(actionTarget) {
    const copied = await copyTextToClipboard(actionTarget.dataset.value || "");
    if (!copied) {
      toast(
        "Copia non riuscita",
        "Seleziona il link nel campo e copialo manualmente.",
        "error",
      );
      return;
    }
    actionTarget.innerHTML = `${icon("checkSimple", 15)} Link copiato`;
    actionTarget.setAttribute("aria-label", "Link copiato");
    toast("Link copiato", "Ora puoi inviarlo personalmente al genitore.");
  }

  function isValidActivationLink(value) {
    try {
      const parsed = new URL(value);
      return ["https:", "http:"].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  function openManualInvitationLink(link, email, context) {
    const details = context || {};
    openModal({
      title: "Link di invito pronto",
      subtitle: "Nessuna e-mail è stata inviata automaticamente.",
      className: "modal--sm",
      body: `
        <div class="info-callout">${icon("info", 18)}<p>Link personale per <strong>${escapeHTML(email)}</strong>. Copialo e condividilo direttamente con il genitore; il link è temporaneo.</p></div>
        <div class="field" style="margin-top:16px"><label for="manual-invite-link">Link di invito</label><input class="input" id="manual-invite-link" value="${escapeHTML(link)}" readonly spellcheck="false" /></div>
      `,
      footer: `<button class="btn btn--secondary" type="button" data-action="close-modal">Chiudi</button><button class="btn btn--secondary" type="button" data-action="generate-family-link" data-family-id="${escapeHTML(details.familyId || "")}" data-student-id="${escapeHTML(details.studentId || "")}" data-email="${escapeHTML(email)}" data-guardian-name="${escapeHTML(details.guardianName || "")}">${icon("repeat", 15)} Genera nuovo link</button><button class="btn btn--primary" type="button" data-action="copy-invitation-link" data-value="${escapeHTML(link)}">${icon("copy", 15)} Copia link</button>`,
    });
  }

  async function handleGenerateFamilyLinkAction(actionTarget) {
    const familyId = actionTarget.dataset.familyId;
    const studentId = actionTarget.dataset.studentId;
    const email = normalizeEmailList([actionTarget.dataset.email])[0] || "";
    if (!email || email.endsWith("@invalid.local")) {
      toast(
        "E-mail famiglia mancante",
        "Inserisci un indirizzo valido nell’anagrafica prima di generare il link.",
        "error",
      );
      return;
    }
    setButtonLoading(actionTarget, true, "Generazione…");
    try {
      const result = await state.store.generateFamilyInviteLink({
        familyId,
        email,
        guardianName: actionTarget.dataset.guardianName,
      });
      if (result.account_status === "active" || result.account_active === true) {
        rememberFamilyAccountStatuses(familyId, [
          { email, account_status: "active", account_active: true },
        ]);
        closeModal();
        toast("Account attivo", "Non è necessario generare un nuovo invito.");
        if (studentId) await openStudentDetails(studentId);
        return;
      }
      const activationLink = result.activation_link || "";
      if (!result.link_generated || !isValidActivationLink(activationLink)) {
        const error = new Error(
          "Supabase non ha restituito un link di invito valido.",
        );
        error.code = "invalid_edge_response";
        throw error;
      }
      rememberFamilyAccountStatuses(familyId, [
        { email, account_status: "pending", account_active: false },
      ]);
      openManualInvitationLink(activationLink, email, {
        familyId,
        studentId,
        guardianName: actionTarget.dataset.guardianName,
      });
    } catch (error) {
      setButtonLoading(actionTarget, false);
      toast(
        error?.code === "family_email_missing"
          ? "E-mail famiglia mancante"
          : "Link non generato",
        error.message || "Controlla la configurazione Supabase e riprova.",
        "error",
      );
    }
  }

  async function handleDeleteStudentAction(actionTarget) {
    const student = state.data.students.find(
      (item) => item.id === actionTarget.dataset.studentId,
    );
    if (!student) return;
    if (
      !window.confirm(
        `Eliminare ${fullName(student)} dagli allievi attivi? Presenze e pagamenti storici verranno conservati.`,
      )
    ) {
      return;
    }
    setButtonLoading(actionTarget, true, "Eliminazione…");
    try {
      await state.store.archiveStudent(student.id);
      closeModal();
      await refreshData();
      toast(
        "Allievo eliminato",
        "È stato rimosso dall’anagrafica attiva; lo storico resta conservato.",
      );
    } catch (error) {
      setButtonLoading(actionTarget, false);
      toast("Allievo non eliminato", error.message, "error");
    }
  }

  async function handleDeleteCourseAction(actionTarget) {
    const course = state.data.courses.find(
      (item) => item.id === actionTarget.dataset.courseId,
    );
    if (!course) return;
    if (
      !window.confirm(
        `Eliminare il corso “${course.name}”? Le iscrizioni verranno chiuse e le lezioni future ancora programmate saranno annullate. Lo storico resterà conservato.`,
      )
    ) {
      return;
    }
    setButtonLoading(actionTarget, true, "Eliminazione…");
    try {
      await state.store.archiveCourse(course.id);
      closeModal();
      await refreshData();
      toast(
        "Corso eliminato",
        "Il corso non è più attivo e lo storico è stato conservato.",
      );
    } catch (error) {
      setButtonLoading(actionTarget, false);
      toast("Corso non eliminato", error.message, "error");
    }
  }

  async function handleDeleteSchoolClosureAction(actionTarget) {
    const closure = (state.data.schoolClosures || []).find(
      (item) => item.id === actionTarget.dataset.closureId,
    );
    if (!closure) return;
    if (
      !window.confirm(
        `Riaprire il ${formatDate(closure.closure_date)}? Le lezioni ordinarie previste dai corsi torneranno automaticamente nel calendario.`,
      )
    ) {
      return;
    }
    setButtonLoading(actionTarget, true, "Riapertura…");
    try {
      const result = await state.store.deleteSchoolClosure(closure.id);
      closeModal();
      await refreshData();
      const restored = Number(result?.restored_lessons || 0);
      toast(
        "Data riaperta",
        restored
          ? `${restored} ${restored === 1 ? "lezione è tornata" : "lezioni sono tornate"} nel calendario.`
          : "La chiusura è stata rimossa dal calendario.",
      );
    } catch (error) {
      setButtonLoading(actionTarget, false);
      toast(
        "Data non riaperta",
        error.message || "Riprova tra poco.",
        "error",
      );
    }
  }

  appRoot.addEventListener("click", async (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;

    if (action === "demo-login") {
      await loginDemo(actionTarget.dataset.role);
    } else if (action === "toggle-password") {
      const input = document.getElementById("login-password");
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      actionTarget.innerHTML = icon(show ? "eyeOff" : "eye", 18);
      actionTarget.setAttribute(
        "aria-label",
        show ? "Nascondi password" : "Mostra password",
      );
    } else if (action === "magic-link") {
      await sendMagicLink();
    } else if (action === "forgot-password") {
      await sendPasswordReset();
    } else if (action === "logout") {
      await logout();
    } else if (action === "reload-page") {
      window.location.reload();
    } else if (action === "dismiss-demo-banner") {
      state.demoBannerVisible = false;
      renderShell();
    } else if (action === "open-student-modal") {
      openStudentModal();
    } else if (action === "edit-student") {
      openStudentModal(actionTarget.dataset.studentId);
    } else if (action === "view-student") {
      await openStudentDetails(actionTarget.dataset.studentId, actionTarget);
    } else if (action === "delete-student") {
      await handleDeleteStudentAction(actionTarget);
    } else if (action === "generate-family-link") {
      await handleGenerateFamilyLinkAction(actionTarget);
    } else if (action === "open-lesson-modal") {
      openLessonModal(actionTarget.dataset.date, {
        courseId: actionTarget.dataset.courseId,
        lessonType: actionTarget.dataset.lessonType,
      });
    } else if (action === "open-school-closure-modal") {
      openSchoolClosureModal(actionTarget.dataset.date);
    } else if (action === "delete-school-closure") {
      await handleDeleteSchoolClosureAction(actionTarget);
    } else if (action === "view-lesson") {
      openLessonDetails(actionTarget.dataset.lessonId);
    } else if (action === "edit-lesson") {
      openEditLessonModal(actionTarget.dataset.lessonId);
    } else if (action === "open-cancel-lesson") {
      openCancelLessonModal(actionTarget.dataset.lessonId);
    } else if (action === "assign-makeup") {
      openAssignMakeupModal(actionTarget.dataset.creditId);
    } else if (action === "open-course-modal") {
      openCourseModal();
    } else if (action === "edit-course") {
      openCourseModal(actionTarget.dataset.courseId);
    } else if (action === "delete-course") {
      await handleDeleteCourseAction(actionTarget);
    } else if (action === "open-invoice-modal") {
      openInvoiceModal();
    } else if (action === "view-invoice") {
      openInvoiceDetails(actionTarget.dataset.invoiceId);
    } else if (action === "open-void-invoice") {
      openVoidInvoiceModal(actionTarget.dataset.invoiceId);
    } else if (action === "open-payment-reminder") {
      openPaymentReminderModal(actionTarget.dataset.invoiceId);
    } else if (action === "mark-invoice-paid") {
      openMarkInvoicePaid(actionTarget.dataset.invoiceId);
    } else if (action === "pay-invoice") {
      openPaymentModal(actionTarget.dataset.invoiceId);
    } else if (action === "close-modal") {
      closeModal();
    } else if (action === "select-attendance-date") {
      state.attendanceDate = actionTarget.dataset.date;
      renderShell();
    } else if (action === "attendance-today") {
      state.attendanceDate = todayKey();
      renderShell();
    } else if (action === "mark-attendance") {
      const lessonId = actionTarget.dataset.lessonId;
      const studentId = actionTarget.dataset.studentId;
      const status = actionTarget.dataset.status;
      const lesson = state.data.lessons.find((item) => item.id === lessonId);
      if (lessonIsOnSchoolClosure(lesson)) {
        toast(
          SCHOOL_CLOSURE_TITLE,
          "Non si possono registrare presenze in una giornata di chiusura.",
          "error",
        );
        return;
      }
      if (status === "absent_excused") {
        openExcusedAbsenceModal(lessonId, studentId);
        return;
      }
      const previous = attendanceFor(lessonId, studentId);
      const snapshot = previous ? { ...previous } : null;
      setLocalAttendance(lessonId, studentId, status);
      renderShell();
      try {
        await state.store.saveAttendance(lessonId, studentId, status);
        scheduleAttendanceEffectsRefresh();
      } catch (error) {
        const current = attendanceFor(lessonId, studentId);
        if (snapshot && current) Object.assign(current, snapshot);
        else if (!snapshot && current) {
          state.data.attendance = state.data.attendance.filter(
            (item) => item !== current,
          );
        }
        renderShell();
        toast(
          "Presenza non salvata",
          error.message || "Riprova tra poco.",
          "error",
        );
      }
    } else if (action === "calendar-prev") {
      state.calendarMonth = addMonths(state.calendarMonth, -1);
      renderShell();
    } else if (action === "calendar-next") {
      state.calendarMonth = addMonths(state.calendarMonth, 1);
      renderShell();
    } else if (action === "calendar-today") {
      state.calendarMonth = startOfMonth(new Date());
      state.calendarSelectedDate = todayKey();
      renderShell();
    } else if (action === "calendar-select-day") {
      state.calendarSelectedDate = actionTarget.dataset.date;
      const selected = toLocalDate(state.calendarSelectedDate);
      state.calendarMonth = startOfMonth(selected);
      renderShell();
    } else if (action === "settings-tab") {
      state.settingsTab = actionTarget.dataset.tab;
      renderShell();
    } else if (action === "select-family-student") {
      state.selectedStudentId = actionTarget.dataset.studentId;
      renderShell();
    } else if (action === "update-lesson-status") {
      const status = actionTarget.dataset.status;
      if (
        status.startsWith("cancelled") &&
        !window.confirm(
          "Vuoi annullare questa lezione? L’operazione resterà visibile nel calendario.",
        )
      ) {
        return;
      }
      setButtonLoading(actionTarget, true, "Salvataggio…");
      try {
        await state.store.updateLessonStatus(
          actionTarget.dataset.lessonId,
          status,
        );
        closeModal();
        await refreshData();
        toast(
          "Lezione aggiornata",
          status === "completed" ? "Segnata come svolta." : "Segnata come annullata.",
        );
      } catch (error) {
        setButtonLoading(actionTarget, false);
        toast("Modifica non salvata", error.message, "error");
      }
    } else if (action === "download-ics") {
      downloadStudentCalendar(actionTarget.dataset.studentId);
    } else if (action === "copy-value") {
      await copyValue(actionTarget.dataset.value || "");
    } else if (action === "copy-invitation-link") {
      await copyInvitationLink(actionTarget);
    } else if (action === "create-makeup-lesson") {
      const courseId = actionTarget.dataset.courseId;
      closeModal();
      openLessonModal(todayKey(), {
        courseId,
        lessonType: "makeup",
      });
    } else if (action === "simulate-paypal") {
      setButtonLoading(actionTarget, true, "Pagamento…");
      try {
        const order = await state.store.createPayPalOrder(
          actionTarget.dataset.invoiceId,
        );
        await state.store.capturePayPalOrder(
          actionTarget.dataset.invoiceId,
          order.orderID || order.order_id,
        );
        closeModal();
        await refreshData();
        toast(
          "Pagamento simulato",
          "La quota è stata aggiornata solo nell’anteprima.",
        );
      } catch (error) {
        setButtonLoading(actionTarget, false);
        toast("Pagamento non riuscito", error.message, "error");
      }
    } else if (action === "dismiss-toast") {
      document.getElementById(actionTarget.dataset.toastId)?.remove();
    }
  });

  appRoot.addEventListener("keydown", (event) => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target.matches('.calendar-day[data-action="calendar-select-day"]')
    ) {
      event.preventDefault();
      event.target.click();
    }
  });

  toastRoot.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="dismiss-toast"]');
    if (button) document.getElementById(button.dataset.toastId)?.remove();
  });

  modalRoot.addEventListener("click", async (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;
    if (action === "modal-backdrop" && event.target === actionTarget) {
      closeModal();
      return;
    }
    // Buttons inside modals use the same action dispatcher as the main app.
    if (action !== "modal-backdrop") {
      appRoot.dispatchEvent(
        new CustomEvent("qm-modal-action", {
          bubbles: false,
          detail: { actionTarget, originalEvent: event },
        }),
      );
    }
  });

  async function handleModalAction(actionTarget) {
    const action = actionTarget.dataset.action;
    if (action === "close-modal") {
      closeModal();
    } else if (action === "open-school-closure-modal") {
      openSchoolClosureModal(actionTarget.dataset.date);
    } else if (action === "delete-school-closure") {
      await handleDeleteSchoolClosureAction(actionTarget);
    } else if (action === "edit-student") {
      openStudentModal(actionTarget.dataset.studentId);
    } else if (action === "delete-student") {
      await handleDeleteStudentAction(actionTarget);
    } else if (action === "generate-family-link") {
      await handleGenerateFamilyLinkAction(actionTarget);
    } else if (action === "delete-course") {
      await handleDeleteCourseAction(actionTarget);
    } else if (action === "edit-course") {
      openCourseModal(actionTarget.dataset.courseId);
    } else if (action === "edit-lesson") {
      openEditLessonModal(actionTarget.dataset.lessonId);
    } else if (action === "mark-invoice-paid") {
      openMarkInvoicePaid(actionTarget.dataset.invoiceId);
    } else if (action === "open-void-invoice") {
      openVoidInvoiceModal(actionTarget.dataset.invoiceId);
    } else if (action === "open-payment-reminder") {
      openPaymentReminderModal(actionTarget.dataset.invoiceId);
    } else if (action === "open-cancel-payment") {
      openCancelManualPaymentModal(actionTarget.dataset.paymentId);
    } else if (action === "open-cancel-lesson") {
      openCancelLessonModal(actionTarget.dataset.lessonId);
    } else if (action === "create-makeup-lesson") {
      const courseId = actionTarget.dataset.courseId;
      closeModal();
      openLessonModal(todayKey(), {
        courseId,
        lessonType: "makeup",
      });
    } else if (action === "update-lesson-status") {
      const status = actionTarget.dataset.status;
      if (
        status.startsWith("cancelled") &&
        !window.confirm(
          "Vuoi annullare questa lezione? L’operazione resterà visibile nel calendario.",
        )
      ) {
        return;
      }
      setButtonLoading(actionTarget, true, "Salvataggio…");
      try {
        await state.store.updateLessonStatus(
          actionTarget.dataset.lessonId,
          status,
        );
        closeModal();
        await refreshData();
        toast("Lezione aggiornata", "La modifica è stata salvata.");
      } catch (error) {
        setButtonLoading(actionTarget, false);
        toast("Modifica non salvata", error.message, "error");
      }
    } else if (action === "copy-value") {
      await copyValue(actionTarget.dataset.value || "");
    } else if (action === "copy-invitation-link") {
      await copyInvitationLink(actionTarget);
    } else if (action === "simulate-paypal") {
      setButtonLoading(actionTarget, true, "Pagamento…");
      try {
        const order = await state.store.createPayPalOrder(
          actionTarget.dataset.invoiceId,
        );
        await state.store.capturePayPalOrder(
          actionTarget.dataset.invoiceId,
          order.orderID || order.order_id,
        );
        closeModal();
        await refreshData();
        toast(
          "Pagamento simulato",
          "La quota è stata aggiornata solo nell’anteprima.",
        );
      } catch (error) {
        setButtonLoading(actionTarget, false);
        toast("Pagamento non riuscito", error.message, "error");
      }
    }
  }

  appRoot.addEventListener("qm-modal-action", (event) => {
    handleModalAction(event.detail.actionTarget);
  });

  let searchRenderTimer = null;
  appRoot.addEventListener("input", (event) => {
    if (event.target.id === "student-search") {
      state.filters.studentSearch = event.target.value;
    } else if (event.target.id === "payment-search") {
      state.filters.paymentSearch = event.target.value;
    } else {
      return;
    }
    const inputId = event.target.id;
    window.clearTimeout(searchRenderTimer);
    searchRenderTimer = window.setTimeout(() => {
      renderShell();
      const input = document.getElementById(inputId);
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }, 120);
  });

  appRoot.addEventListener("change", (event) => {
    if (event.target.id === "student-course-filter") {
      state.filters.studentCourse = event.target.value;
      renderShell();
    } else if (event.target.id === "payment-status-filter") {
      state.filters.paymentStatus = event.target.value;
      renderShell();
    } else if (event.target.id === "attendance-date-picker") {
      state.attendanceDate = event.target.value || todayKey();
      renderShell();
    }
  });

  modalRoot.addEventListener("change", (event) => {
    if (event.target.id === "lesson-course") {
      const course = state.data.courses.find(
        (item) => item.id === event.target.value,
      );
      const duration = document.getElementById("lesson-duration");
      const location = document.getElementById("lesson-location");
      if (duration && course) duration.value = course.duration_minutes || 50;
      if (location && course) location.value = course.location || "";
    } else if (event.target.id === "student-family-id") {
      const family = state.data.families.find(
        (item) => item.id === event.target.value,
      );
      if (!family) return;
      const fields = {
        "guardian-name": family.guardian_name,
        "family-display-name": family.display_name,
        "guardian-email": family.email,
        "guardian-phone": family.phone,
      };
      Object.entries(fields).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (input) input.value = value || "";
      });
      const additionalEmails = document.getElementById(
        "guardian-additional-emails",
      );
      if (additionalEmails) {
        const primaryEmail = normalizeEmailList([family.email])[0] || "";
        additionalEmails.value = familyAccessEmails(family)
          .filter((email) => email !== primaryEmail)
          .join("\n");
      }
    }
  });

  async function handleFormSubmit(event) {
    const form = event.target;
    const formId = form.getAttribute("id");
    const button =
      event.submitter ||
      document.querySelector(`[form="${formId}"][type="submit"]`) ||
      form.querySelector('[type="submit"]');
    const values = formValues(form);

    if (formId === "login-form") {
      await loginWithPassword(form, button);
      return;
    }

    setButtonLoading(button, true, "Salvataggio…");
    try {
      if (formId === "student-form") {
        if (!values.family_id && (!values.guardian_name || !values.email)) {
          throw new Error(
            "Per una nuova famiglia inserisci nome del tutore ed e-mail.",
          );
        }
        values.fiscal_code = String(values.fiscal_code || "")
          .trim()
          .toUpperCase();
        if (
          values.fiscal_code &&
          !/^[A-Z0-9]{16}$/.test(values.fiscal_code)
        ) {
          throw new Error("Il codice fiscale deve contenere 16 caratteri.");
        }
        const primaryEmail = normalizeEmailList([values.email])[0] || "";
        const additionalEmails = normalizeEmailList(values.additional_emails);
        const invalidEmails = [primaryEmail, ...additionalEmails].filter(
          (email) => email && !isValidEmail(email),
        );
        if (invalidEmails.length) {
          throw new Error(`Controlla questi indirizzi e-mail: ${invalidEmails.join(", ")}.`);
        }
        if (additionalEmails.length > 10) {
          throw new Error("Puoi aggiungere al massimo 10 nuovi indirizzi alla volta.");
        }
        values.email = primaryEmail;
        values.access_emails = normalizeEmailList([
          primaryEmail,
          ...additionalEmails,
        ]);
        await state.store.saveStudent(values);
        closeModal();
        await refreshData();
        toast(
          values.id ? "Allievo aggiornato" : "Allievo aggiunto",
          values.id
            ? "Le modifiche sono state salvate."
            : "I dati sono salvati. Genera il link di invito dalla scheda dell’allievo.",
        );
      } else if (formId === "school-closure-form") {
        const closureDate = String(values.closure_date || "");
        const description = String(values.description || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(closureDate)) {
          throw new Error("Indica una data di chiusura valida.");
        }
        if (description.length > 120) {
          throw new Error("La descrizione non può superare 120 caratteri.");
        }
        const result = await state.store.saveSchoolClosure(
          closureDate,
          description,
        );
        state.calendarMonth = startOfMonth(toLocalDate(closureDate));
        state.calendarSelectedDate = closureDate;
        closeModal();
        await refreshData();
        const manualLessons = Number(result?.manual_lessons || 0);
        const affectedCourses = Number(result?.affected_courses || 0);
        toast(
          "Chiusura salvata",
          manualLessons
            ? `${manualLessons} ${manualLessons === 1 ? "appuntamento manuale resta" : "appuntamenti manuali restano"} da verificare in questa data.`
            : affectedCourses
              ? `Il calendario di ${affectedCourses} ${affectedCourses === 1 ? "corso è stato aggiornato" : "corsi è stato aggiornato"}.`
              : "La chiusura è ora visibile nel calendario.",
        );
      } else if (formId === "lesson-form") {
        if (schoolClosureForDate(values.date)) {
          throw new Error(
            "La data è segnata come chiusura. Riaprila prima di aggiungere una lezione.",
          );
        }
        const start = romeDateTime(values.date, values.time);
        if (Number.isNaN(start.getTime())) {
          throw new Error("Data o ora della lezione non valida.");
        }
        const course = state.data.courses.find(
          (item) => item.id === values.course_id,
        );
        await state.store.saveLesson({
          ...values,
          starts_at: start.toISOString(),
          repeat_until: null,
          title: values.title || course?.name || "Lezione",
        });
        state.calendarMonth = startOfMonth(start);
        state.calendarSelectedDate = dateKey(start);
        closeModal();
        await refreshData();
        toast(
          "Lezione creata",
          "La data è ora nel calendario. Le serie ordinarie restano collegate al corso.",
        );
      } else if (formId === "edit-lesson-form") {
        if (schoolClosureForDate(values.date)) {
          throw new Error(
            "La data è segnata come chiusura. Scegli un’altra giornata.",
          );
        }
        const start = romeDateTime(values.date, values.time);
        if (Number.isNaN(start.getTime())) {
          throw new Error("Data o ora della lezione non valida.");
        }
        await state.store.updateLesson({
          ...values,
          starts_at: start.toISOString(),
        });
        state.calendarMonth = startOfMonth(start);
        state.calendarSelectedDate = dateKey(start);
        closeModal();
        await refreshData();
        toast(
          "Lezione aggiornata",
          "La nuova data e le informazioni sono visibili alle famiglie.",
        );
      } else if (formId === "course-form") {
        const scheduleValues = [
          values.starts_on,
          values.ends_on,
          values.weekday,
          values.start_time,
        ];
        const completedScheduleFields = scheduleValues.filter(Boolean).length;
        if (![0, 4].includes(completedScheduleFields)) {
          throw new Error(
            "Per il calendario automatico compila insieme inizio, fine, giorno e ora.",
          );
        }
        if (completedScheduleFields === 4) {
          const startsOn = toLocalDate(values.starts_on);
          const endsOn = toLocalDate(values.ends_on);
          const durationDays = Math.round(
            (endsOn.getTime() - startsOn.getTime()) / 86400000,
          );
          if (Number.isNaN(durationDays) || durationDays < 0) {
            throw new Error(
              "La data di fine del corso deve essere successiva all’inizio.",
            );
          }
          if (durationDays > 731) {
            throw new Error("Il periodo del corso non può superare due anni.");
          }
          if (!COURSE_WEEKDAYS[Number(values.weekday)]) {
            throw new Error("Scegli un giorno valido per la lezione.");
          }
        }
        const result = await state.store.saveCourse(values);
        closeModal();
        await refreshData();
        toast(
          "Corso e calendario aggiornati",
          completedScheduleFields === 4
            ? `${Number(result?.calendar_lessons || 0)} lezioni ordinarie sono collegate a questo corso.`
            : "Il corso è salvato senza una programmazione settimanale fissa.",
        );
      } else if (formId === "assign-makeup-form") {
        const targetLesson = state.data.lessons.find(
          (lesson) => lesson.id === values.lesson_id,
        );
        if (lessonIsOnSchoolClosure(targetLesson)) {
          throw new Error(
            "La sessione scelta cade in una giornata di chiusura.",
          );
        }
        await state.store.assignMakeup(values.credit_id, values.lesson_id);
        closeModal();
        await refreshData();
        toast(
          "Recupero assegnato",
          "La data è ora visibile anche nell’area della famiglia.",
        );
      } else if (formId === "cancel-lesson-form") {
        await state.store.updateLessonStatus(
          values.lesson_id,
          values.status,
          values.cancellation_reason,
        );
        closeModal();
        await refreshData();
        toast(
          "Lezione annullata",
          "Il cambiamento e il motivo sono visibili alle famiglie interessate.",
        );
      } else if (formId === "invoice-form") {
        const student = state.data.students.find(
          (item) => item.id === values.student_id,
        );
        if (!student) throw new Error("Seleziona un allievo.");
        await state.store.saveInvoice({
          ...values,
          family_id: student.family_id,
        });
        closeModal();
        await refreshData();
        toast(
          "Scadenza creata",
          "La famiglia può ora visualizzarla nella propria area.",
        );
      } else if (formId === "void-invoice-form") {
        const reason = String(values.reason || "").trim();
        if (!reason) throw new Error("Indica il motivo dell’annullamento.");
        await state.store.voidInvoice(values.invoice_id, reason);
        closeModal();
        await refreshData();
        toast(
          "Scadenza eliminata",
          "È stata annullata e nascosta alle famiglie; lo storico resta conservato.",
        );
      } else if (formId === "cancel-payment-form") {
        const reason = String(values.reason || "").trim();
        if (!reason) throw new Error("Indica il motivo dell’annullamento.");
        await state.store.cancelManualPayment(values.payment_id, reason);
        closeModal();
        await refreshData();
        toast(
          "Incasso annullato",
          "Il saldo è stato ricalcolato e il movimento resta nello storico.",
        );
      } else if (formId === "mark-paid-form") {
        const paidOn = String(values.paid_on || "").trim();
        if (!paidOn) {
          throw new Error("Indica la data in cui è avvenuto il pagamento.");
        }
        if (paidOn > todayKey()) {
          throw new Error("La data del pagamento non può essere futura.");
        }
        await state.store.markInvoicePaid(
          values.invoice_id,
          values.method,
          paidOn,
        );
        closeModal();
        await refreshData();
        toast(
          "Incasso registrato",
          `La scadenza risulta pagata il ${formatDate(paidOn)} via ${paymentMethodLabel(values.method)}.`,
        );
      } else if (formId === "payment-reminder-form") {
        const result = await state.store.sendPaymentReminder(
          values.invoice_id,
        );
        closeModal();
        await refreshData();
        toast(
          result?.created === false
            ? "Promemoria già presente"
            : "Notifica inviata",
          result?.created === false
            ? "Per questa fattura era già stato inviato un promemoria."
            : "Il promemoria è ora visibile nell’area della famiglia.",
        );
      } else if (formId === "settings-school-form") {
        await state.store.saveSettings(values);
        await refreshData();
        toast("Impostazioni salvate", "I dati dello studio sono aggiornati.");
      } else if (formId === "settings-rules-form") {
        await state.store.saveSettings({
          ...values,
          absence_notice_hours: Number(values.absence_notice_hours || 24),
        });
        await refreshData();
        toast("Regole salvate", "Le nuove date sono ora attive.");
      } else if (formId === "settings-payments-form") {
        await state.store.saveSettings(values);
        await refreshData();
        toast(
          "Dati di pagamento salvati",
          "Le famiglie vedranno le nuove coordinate.",
        );
      } else if (formId === "set-password-form") {
        if (values.password !== values.confirm_password) {
          throw new Error("Le due password non coincidono.");
        }
        if (String(values.password || "").length < 12) {
          throw new Error("Usa almeno 12 caratteri.");
        }
        if (
          !/[a-z]/.test(values.password) ||
          !/[A-Z]/.test(values.password) ||
          !/[0-9]/.test(values.password) ||
          !/[^A-Za-z0-9]/.test(values.password)
        ) {
          throw new Error(
            "Inserisci almeno una maiuscola, una minuscola, un numero e un simbolo.",
          );
        }
        const { error } = await state.supabase.auth.updateUser({
          password: values.password,
        });
        if (error) throw error;
        closeModal();
        const prefix = state.role === ROLE_ADMIN ? "admin" : "famiglia";
        const route = state.role === ROLE_ADMIN ? "overview" : "home";
        replaceAppRoute(`#/${prefix}/${route}`, true);
        renderShell();
        toast("Password salvata", "Il tuo accesso è ora completo.");
      } else if (formId === "excused-absence-form") {
        const notified = new Date(values.absence_notified_at);
        if (Number.isNaN(notified.getTime())) {
          throw new Error("Inserisci data e ora della comunicazione.");
        }
        await state.store.saveAttendance(
          values.lesson_id,
          values.student_id,
          "absent_excused",
          notified.toISOString(),
        );
        closeModal();
        await refreshData();
        toast(
          "Assenza registrata",
          "L’eventuale diritto al recupero è stato verificato.",
        );
      }
    } catch (error) {
      setButtonLoading(button, false);
      toast(
        "Operazione non completata",
        error.message || "Controlla i dati e riprova.",
        "error",
      );
    }
  }

  appRoot.addEventListener("submit", (event) => {
    event.preventDefault();
    handleFormSubmit(event);
  });

  modalRoot.addEventListener("submit", (event) => {
    event.preventDefault();
    handleFormSubmit(event);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalRoot.innerHTML) closeModal();
    if (event.key === "Tab" && modalRoot.innerHTML) {
      const focusable = Array.from(
        modalRoot.querySelectorAll(
          "button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), a[href]",
        ),
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  window.addEventListener("hashchange", () => {
    if (!state.user || !state.role || !state.data) return;
    closeModal();
    if (window.location.hash === "#/set-password") {
      renderShell();
      openSetPasswordModal();
      return;
    }
    renderShell();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === AUTH_EMAIL_COOLDOWN_KEY) syncAuthEmailCooldown();
  });

  let visibilityRefreshInFlight = false;
  document.addEventListener("visibilitychange", async () => {
    if (
      document.visibilityState !== "visible" ||
      visibilityRefreshInFlight ||
      !state.user ||
      !state.role ||
      !state.data ||
      Date.now() - state.lastDataRefreshAt < 30000
    ) {
      return;
    }
    visibilityRefreshInFlight = true;
    try {
      await refreshData();
    } catch (error) {
      console.warn("Aggiornamento dati non riuscito:", error);
    } finally {
      visibilityRefreshInFlight = false;
    }
  });

  async function init() {
    try {
      const demoRole = new URLSearchParams(window.location.search).get("demo");
      if ([ROLE_ADMIN, ROLE_FAMILY].includes(demoRole)) {
        state.store = new DemoStore();
        state.loading = false;
        await loginDemo(demoRole);
        return;
      }
      if (!isSupabaseConfigured) {
        state.store = new DemoStore();
        state.loading = false;
        renderLogin();
        return;
      }
      if (!window.supabase?.createClient) {
        throw new Error(
          "La libreria di connessione non è disponibile. Controlla la rete.",
        );
      }
      state.supabase = window.supabase.createClient(
        config.supabaseUrl,
        config.supabaseAnonKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        },
      );
      state.store = new SupabaseStore(state.supabase);

      const processAuthSession = async (authSession, eventName) => {
        if (!authSession?.user) return;
        const setPassword =
          eventName === "PASSWORD_RECOVERY" ||
          new URLSearchParams(window.location.search).get("auth_action") ===
            "set-password" ||
          window.location.hash === "#/set-password";
        const fingerprint = `${authSession.user.id}:${String(
          authSession.access_token || "",
        ).slice(-16)}:${setPassword}`;
        if (state.authFingerprint === fingerprint) return;
        state.authFingerprint = fingerprint;
        await loadAuthenticatedUser(authSession.user, setPassword);
      };

      const { data: listener } = state.supabase.auth.onAuthStateChange(
        (event, authSession) => {
          window.setTimeout(async () => {
            if (event === "SIGNED_OUT") {
              await stopPaymentReminderRealtime();
              state.authFingerprint = null;
              state.user = null;
              state.profile = null;
              state.role = null;
              state.data = null;
              state.familyAccountStatuses = {};
              renderLogin();
            } else if (
              authSession?.user &&
              ["INITIAL_SESSION", "SIGNED_IN", "PASSWORD_RECOVERY"].includes(
                event,
              )
            ) {
              await processAuthSession(authSession, event);
            }
          }, 0);
        },
      );
      state.authListener = listener.subscription;

      const {
        data: { session },
        error,
      } = await state.supabase.auth.getSession();
      if (error) throw error;
      if (session?.user) {
        await processAuthSession(session, "GET_SESSION");
      } else {
        const authAction = new URLSearchParams(window.location.search).get(
          "auth_action",
        );
        renderLogin(
          authAction === "set-password" ||
            window.location.hash === "#/set-password"
            ? "Il link è scaduto o non valido. Richiedine uno nuovo."
            : "",
        );
      }
    } catch (error) {
      renderFatalError(error);
    }
  }

  init();
})();
