import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './modules/auth/AuthContext';
import LoginScreen from './modules/auth/LoginScreen';
import Layout from './components/Layout';
import DashboardPage from './modules/dashboard/DashboardPage';
import ArticulosPage from './modules/articulos/ArticulosPage';
import VentasPage from './modules/ventas/VentasPage';
import ReportesPage from './modules/reportes/ReportesPage';
import ClientesPage from './modules/clientes/ClientesPage';
import UsuariosPage from './modules/usuarios/UsuariosPage';
import ConfiguracionPage from './modules/configuracion/ConfiguracionPage';

export default function App() {
  const { sesion, cargando, esAdmin } = useAuth();

  if (cargando) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        Cargando...
      </div>
    );
  }

  if (!sesion) {
    return <LoginScreen />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/articulos" element={<ArticulosPage />} />
        <Route path="/ventas" element={<VentasPage />} />
        <Route path="/reportes" element={<ReportesPage />} />
        <Route path="/clientes" element={<ClientesPage />} />
        <Route path="/usuarios" element={esAdmin ? <UsuariosPage /> : <Navigate to="/" replace />} />
        <Route
          path="/configuracion"
          element={esAdmin && window.escritorio ? <ConfiguracionPage /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
