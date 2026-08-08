/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'mock' | 'supabase';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_MAPBOX_TOKEN?: string;
  readonly VITE_EDGE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// mapbox-gl-draw ships its own types via @types/mapbox__mapbox-gl-draw; this
// keeps the CSS side-effect imports type-safe under strict mode.
declare module '*.css';
