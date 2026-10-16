import { useEffect, useState, type FormEvent } from 'react';
import {
  Heart,
  Lock,
  User,
  ChevronLeft,
  ShoppingCart,
  Users,
  Smartphone,
  ShoppingBag,
  Candy,
  Cookie,
  Coffee,
  IceCreamCone,
  Milk,
  Package,
  Beer,
  X,
} from 'lucide-react';
import { etiquetaRol, type CuentaPublica } from '@shared/types';
import { useAuth } from './AuthContext';
import { cuentasRecordadas, olvidarCuenta } from '../../webApiClient';
import CampoContrasena from '../../components/CampoContrasena';

const RASGOS = [
  { icon: ShoppingCart, texto: 'Ventas y stock siempre al día' },
  { icon: Users, texto: 'Fiados anotados con nombre y hora' },
  { icon: Smartphone, texto: 'Desde la PC o el celular, como quieras' },
];

// Iconitos de productos de almacén/kiosco, desparramados de fondo — para que
// se sienta "de este negocio" en vez de un login genérico. Puramente
// decorativos (pointer-events-none, muy tenues).
const PRODUCTOS_FONDO = [
  { icon: ShoppingBag, top: '8%', left: '78%', size: 'h-16 w-16', rotate: '-12deg' },
  { icon: Candy, top: '18%', left: '12%', size: 'h-10 w-10', rotate: '10deg' },
  { icon: Cookie, top: '68%', left: '82%', size: 'h-12 w-12', rotate: '8deg' },
  { icon: Coffee, top: '78%', left: '18%', size: 'h-11 w-11', rotate: '-8deg' },
  { icon: IceCreamCone, top: '38%', left: '86%', size: 'h-10 w-10', rotate: '14deg' },
  { icon: Milk, top: '52%', left: '6%', size: 'h-10 w-10', rotate: '-10deg' },
  { icon: Package, top: '10%', left: '42%', size: 'h-9 w-9', rotate: '6deg' },
  { icon: Beer, top: '85%', left: '48%', size: 'h-10 w-10', rotate: '-14deg' },
];

export default function LoginScreen() {
  const { login } = useAuth();
  const [cuentas, setCuentas] = useState<CuentaPublica[] | null>(null);
  // Las cuentas que salen del aparato (en internet no hay lista pública).
  const [deEsteAparato, setDeEsteAparato] = useState(false);
  const [cuentaElegida, setCuentaElegida] = useState<CuentaPublica | null>(null);
  const [modoManual, setModoManual] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    window.api.auth
      .cuentas()
      .then((lista) => setCuentas(lista))
      // Si no hay lista (en internet no se ofrece, o la red falló) se usan las
      // cuentas que ya entraron desde este aparato; y si tampoco hay, no
      // dejamos a nadie afuera: se muestra directo el formulario de siempre.
      .catch(() => {
        const recordadas = cuentasRecordadas();
        if (recordadas.length > 0) {
          setCuentas(recordadas);
          setDeEsteAparato(true);
        } else {
          setModoManual(true);
        }
      });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await login((cuentaElegida?.usuario ?? usuario).trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setEnviando(false);
    }
  }

  function volverAlSelector() {
    setCuentaElegida(null);
    setModoManual(false);
    setPassword('');
    setError(null);
  }

  const horaSaludo = new Date().getHours();
  const saludo = horaSaludo < 12 ? 'Buen día' : horaSaludo < 20 ? 'Buenas tardes' : 'Buenas noches';

  const mostrarSelector = !modoManual && !cuentaElegida && cuentas !== null && cuentas.length > 0;
  const mostrarPassword = modoManual || cuentaElegida !== null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 lg:flex-row">
      {/* Panel izquierdo: la marca. En el celular se achica a una franja
          compacta arriba; en pantallas grandes ocupa la mitad, con la
          "personalidad" de la app (nombre, para qué sirve, degradé propio) —
          así el login deja de sentirse como un formulario genérico. */}
      <div className="relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-brand-600 via-violet-800 to-brand-900 px-6 py-10 text-white lg:min-h-screen lg:w-1/2 lg:px-16 lg:py-16">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="pointer-events-none absolute inset-0">
          <div className="animate-float-slow absolute -left-16 -top-16 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div
            className="animate-float-slow absolute -bottom-20 -right-10 h-80 w-80 rounded-full bg-rose-400/20 blur-3xl"
            style={{ animationDelay: '-5s' }}
          />
        </div>

        {/* Productos del almacén desparramados de fondo, bien tenues — para
            que el login se sienta de "este" negocio y no un formulario
            genérico. Ocultos en pantallas chicas, donde este panel ya se
            achica a una franja y no hay lugar para que respiren. */}
        <div className="pointer-events-none absolute inset-0 hidden lg:block">
          {PRODUCTOS_FONDO.map(({ icon: Icon, top, left, size, rotate }, i) => (
            <Icon
              key={i}
              className={`absolute text-white/10 ${size}`}
              style={{ top, left, transform: `rotate(${rotate})` }}
              strokeWidth={1.5}
            />
          ))}
        </div>

        <div className="relative z-10 flex w-full max-w-sm flex-col items-center text-center lg:items-start lg:text-left">
          <div className="mb-4 flex h-14 w-14 origin-[70%_70%] animate-wave items-center justify-center rounded-2xl bg-white/15 shadow-lg lg:h-16 lg:w-16">
            <Heart className="h-7 w-7 lg:h-8 lg:w-8" fill="currentColor" />
          </div>
          <h1 className="text-2xl font-semibold lg:text-4xl">Mis Amores</h1>
          <p className="mt-2 text-sm text-brand-100 lg:text-base">
            Bienvenido al sistema del Almacén Mis Amores
          </p>

          <div className="mt-8 hidden w-full space-y-3 lg:block">
            {RASGOS.map(({ icon: Icon, texto }) => (
              <div key={texto} className="flex items-center gap-3 text-brand-50">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-4 w-4" />
                </div>
                <p className="text-sm">{texto}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Panel derecho: el formulario en sí. Ya no es blanco liso — un
          degradé apenas visible y un par de productos de fondo bien tenues
          para que no se sienta vacío, sin competir con el formulario. */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden p-4 sm:p-8"
        style={{
          backgroundColor: '#fafbfe',
          backgroundImage:
            'radial-gradient(circle at 85% 15%, rgba(59, 118, 209, 0.07), transparent 40%), radial-gradient(circle at 10% 90%, rgba(216, 70, 160, 0.05), transparent 40%)',
        }}
      >
        <ShoppingBag
          className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 text-brand-900/[0.04]"
          strokeWidth={1.2}
        />
        <Cookie
          className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 text-brand-900/[0.04]"
          strokeWidth={1.2}
        />
        <div className="relative w-full max-w-sm animate-slide-up">
          <p className="mb-4 text-center text-sm text-slate-400 lg:text-left">
            {saludo} 👋 — {mostrarPassword && cuentaElegida ? 'ingresá tu contraseña' : 'elegí con quién vas a entrar'}
          </p>

          {mostrarSelector && (
            <div className="card animate-scale-in space-y-1.5 p-3 shadow-xl">
              {cuentas!.map((c) => (
                <div key={c.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setCuentaElegida(c)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-slate-50 ${
                      deEsteAparato ? 'pr-11' : ''
                    }`}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                      {c.nombre[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-800">{c.nombre}</p>
                      <p className="text-xs text-slate-400">{etiquetaRol(c.rol, c.genero)}</p>
                    </div>
                  </button>
                  {deEsteAparato && (
                    <button
                      type="button"
                      onClick={() => {
                        const restantes = olvidarCuenta(c.usuario);
                        if (restantes.length === 0) {
                          setCuentas(null);
                          setDeEsteAparato(false);
                          setModoManual(true);
                        } else {
                          setCuentas(restantes);
                        }
                      }}
                      title="Sacar esta cuenta de este aparato"
                      aria-label={`Sacar a ${c.nombre} de este aparato`}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setModoManual(true)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-center text-xs text-slate-400 hover:underline"
              >
                {deEsteAparato ? 'Entrar con otro usuario' : 'Ingresar con usuario y contraseña'}
              </button>
            </div>
          )}

          {mostrarPassword && (
            <form onSubmit={handleSubmit} className="card animate-scale-in space-y-4 p-6 shadow-xl">
              {cuentaElegida ? (
                <button
                  type="button"
                  onClick={volverAlSelector}
                  className="-m-1 mb-1 flex items-center gap-2 rounded-lg p-1 text-left transition-colors hover:bg-slate-50"
                >
                  <ChevronLeft className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                    {cuentaElegida.nombre[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-slate-400">Vas a entrar como</p>
                    <p className="truncate text-sm font-medium text-slate-800">{cuentaElegida.nombre}</p>
                  </div>
                </button>
              ) : (
                <div>
                  <label className="label" htmlFor="usuario">
                    Usuario
                  </label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="usuario"
                      className="input pl-9"
                      value={usuario}
                      onChange={(e) => setUsuario(e.target.value)}
                      // Sin mayúscula automática ni "corrección": el usuario se escribe tal cual.
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="username"
                      autoFocus
                      required
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="label" htmlFor="password">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <CampoContrasena
                    id="password"
                    className="input pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus={!!cuentaElegida}
                    required
                  />
                </div>
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

              <button type="submit" className="btn-primary w-full" disabled={enviando}>
                {enviando ? 'Ingresando...' : 'Ingresar'}
              </button>

              {modoManual && cuentas && cuentas.length > 0 && (
                <button
                  type="button"
                  onClick={volverAlSelector}
                  className="w-full text-center text-xs text-slate-400 hover:underline"
                >
                  Elegir una cuenta de la lista
                </button>
              )}
            </form>
          )}

          {!mostrarSelector && !mostrarPassword && (
            <div className="card animate-scale-in p-6 text-center text-sm text-slate-400 shadow-xl">Cargando...</div>
          )}

          <p className="mt-4 text-center text-xs text-slate-400 lg:text-left">
            ¿Olvidaste tu contraseña? Pedile a la jefa que te la reestablezca desde Usuarios.
          </p>
        </div>
      </div>
    </div>
  );
}
