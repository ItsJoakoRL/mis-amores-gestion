import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './modules/auth/AuthContext';
import { crearWebApiClient } from './webApiClient';
import './index.css';

// Dentro de Electron, el preload ya dejó window.api listo. Si no existe, es
// porque se abrió esta misma app desde el navegador de un celular — ahí se
// arma un reemplazo que habla por HTTP con el servidor de la PC.
if (!window.api) {
  window.api = crearWebApiClient();
}

// Los cuadros nativos (alert/confirm) dejan la ventana de escritorio sin el foco del teclado (los
// campos no dejan escribir): después de cada uno se le devuelve el foco a la ventana.
for (const nombre of ['alert', 'confirm'] as const) {
  const original = window[nombre].bind(window) as (mensaje?: string) => boolean | void;
  (window as unknown as Record<string, unknown>)[nombre] = (mensaje?: string) => {
    const resultado = original(mensaje);
    try {
      window.api.sistema.reenfocarVentana();
    } catch {
      // sin ventana de escritorio (o una versión vieja del puente): no pasa nada
    }
    return resultado;
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);
