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

declare module 'virtual:pwa-register/react' {
  export function useRegisterSW(): {
    offlineReady: [boolean, (value: boolean) => void];
    needRefresh: [boolean, (value: boolean) => void];
    updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  };
}

