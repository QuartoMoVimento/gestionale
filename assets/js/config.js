/*
 * Configurazione pubblica del frontend.
 *
 * Il workflow GitHub Pages sostituisce questo file durante la pubblicazione
 * usando le variabili del repository. La chiave qui prevista è esclusivamente
 * la publishable/anon key di Supabase: non inserire mai service_role key,
 * PayPal secret, IBAN o altre credenziali private in questo file.
 */
window.QM_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  paypalClientId: "",
  paypalCurrency: "EUR",
  paypalEnvironment: "sandbox",
  siteName: "Area corsi · Quarto MoVimento",
  supportEmail: "valeria@quartomovimento.it",
  supportPhone: "327 774 9860",
  websiteUrl: "https://www.quartomovimento.it",
};
