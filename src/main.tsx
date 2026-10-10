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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);
