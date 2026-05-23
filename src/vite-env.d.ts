/// <reference types="vite/client" />

declare module 'virtual:pwa-register/react' {
  export function useRegisterSW(): {
    offlineReady: [boolean, (value: boolean) => void];
    needRefresh: [boolean, (value: boolean) => void];
    updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  };
}
