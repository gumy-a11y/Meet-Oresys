/* Configuration de Meet'Oresys.
   Les deux valeurs se trouvent dans Supabase > Settings > API Keys.
   La clé "publishable" (ex-"anon") est publique par conception : ce sont les règles du fichier
   supabase/schema.sql qui protègent les données. Ne mettez jamais ici la
   clé "secret" (sb_secret_...) ni l'ancienne "service_role". */
window.CONFIG = {
  SUPABASE_URL: "https://ccudwrvspujkfebrttih.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable__QHMjZwBUxLEvL2-gmsNsw_KNsel7cF",

  // Domaine des adresses autorisées à créer un compte. Doit être le même
  // que dans supabase/schema.sql (fonctions is_oresys et inscription_oresys_uniquement).
  ALLOWED_DOMAIN: "oresys.eu",

  // Point de départ des temps de trajet.
  ORIGIN: { lat: 48.8789, lng: 2.3260, addr: "48 rue de Londres, 75009 Paris" }
};
