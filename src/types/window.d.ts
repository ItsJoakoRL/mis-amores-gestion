import type { Api, Escritorio } from '../../electron/preload';

declare global {
  interface Window {
    api: Api;
    /** Sólo en la app de escritorio; en el navegador de un celular no existe. */
    escritorio?: Escritorio;
  }
}

export {};
