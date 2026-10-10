import { useState } from 'react';
import { Plus, Check, X } from 'lucide-react';

interface Opcion {
  id: string;
  nombre: string;
}

interface Props {
  label: string;
  opciones: Opcion[];
  valor: string | null;
  onCambiar: (id: string | null) => void;
  onCrear: (nombre: string) => Promise<Opcion>;
  placeholder?: string;
}

// Para comparar nombres sin que importen mayúsculas, tildes ni espacios de más.
const RANGO_DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
function normalizar(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(RANGO_DIACRITICOS, '');
}

// Select estándar + la posibilidad de dar de alta una opción nueva sin salir
// del formulario (ej. una marca o rubro que todavía no existe en la lista).
export default function SelectConCrear({ label, opciones, valor, onCambiar, onCrear, placeholder }: Props) {
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelar() {
    setCreando(false);
    setNombreNuevo('');
    setError(null);
  }

  async function confirmarCreacion() {
    const nombre = nombreNuevo.trim();
    if (!nombre) {
      cancelar();
      return;
    }
    // Si ya existe (aunque esté escrito con otras mayúsculas o sin tilde), se
    // elige ése en vez de crear un duplicado — antes eso fallaba sin avisar
    // nada y el cuadro quedaba ahí trabado.
    const existente = opciones.find((op) => normalizar(op.nombre) === normalizar(nombre));
    if (existente) {
      onCambiar(existente.id);
      cancelar();
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const nueva = await onCrear(nombre);
      onCambiar(nueva.id);
      cancelar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear');
    } finally {
      setGuardando(false);
    }
  }

  if (creando) {
    return (
      <div>
        <label className="label">{label}</label>
        <div className="flex gap-1.5">
          <input
            autoFocus
            className="input"
            placeholder="Nombre nuevo..."
            value={nombreNuevo}
            onChange={(e) => {
              setNombreNuevo(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && confirmarCreacion()}
          />
          <button type="button" className="btn-primary px-2.5" onClick={confirmarCreacion} disabled={guardando}>
            <Check className="h-4 w-4" />
          </button>
          <button type="button" className="btn-secondary px-2.5" onClick={cancelar}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-1.5">
        <select
          className="input"
          value={valor ?? ''}
          onChange={(e) => onCambiar(e.target.value || null)}
        >
          <option value="">{placeholder ?? 'Sin especificar'}</option>
          {opciones.map((op) => (
            <option key={op.id} value={op.id}>
              {op.nombre}
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary px-2.5" title={`Crear ${label.toLowerCase()}`} onClick={() => setCreando(true)}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
