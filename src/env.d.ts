interface ImportMetaEnv {
  readonly WXT_SUPABASE_URL: string;
  readonly WXT_SUPABASE_ANON_KEY: string;
  readonly WXT_CRM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
