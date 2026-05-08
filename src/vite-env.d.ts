/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_SECRET?: string;
  readonly VITE_MPESA_CONSUMER_KEY?: string;
  readonly VITE_MPESA_CONSUMER_SECRET?: string;
  readonly VITE_MPESA_PASSKEY?: string;
  readonly VITE_MPESA_SHORTCODE?: string;
  readonly VITE_MPESA_CALLBACK_URL?: string;
  readonly VITE_MPESA_ENVIRONMENT?: 'sandbox' | 'production';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

