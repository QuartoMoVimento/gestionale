/*
 * Configurazione pubblica del frontend.
 *
 * URL e publishable key Supabase sono valori pubblici destinati al browser.
 * Il workflow GitHub Pages può sostituirli con le variabili del repository.
 * Non inserire mai service_role key, PayPal secret, IBAN o altre credenziali
 * private in questo file.
 */
window.QM_CONFIG = {
  supabaseUrl: "https://uexwvbrvqphlcwxpgrku.supabase.co",
  supabaseAnonKey: "sb_publishable_1p7YJp6v12m7GCBnMFr0GQ_1ru0BrwR",
  paypalClientId: "",
  paypalCurrency: "EUR",
  paypalEnvironment: "sandbox",
  siteName: "Area corsi · Quarto MoVimento",
  supportEmail: "valeria@quartomovimento.it",
  supportPhone: "327 774 9860",
  websiteUrl: "https://www.quartomovimento.it",
};
