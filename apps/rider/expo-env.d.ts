/// <reference types="expo/types" />

// Ambient env typing for EXPO_PUBLIC_* vars used across the app.
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_DATA_SOURCE?: 'mock' | 'supabase';
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    EXPO_PUBLIC_MAPBOX_TOKEN?: string;
    EXPO_PUBLIC_EDGE_BASE_URL?: string;
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  }
}
