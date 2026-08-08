/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'supabase';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_MAPBOX_TOKEN?: string;
  readonly VITE_EDGE_BASE_URL?: string;
  /** Built-in brand id to pin this deployment to (see context/BrandContext). */
  readonly VITE_BRAND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
