import type React from 'react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Cliente } from '@shared/types';

interface Props {
  clientesExistentes: Cliente[];
  onCerrar: () => void;
  onCreado: (cliente: Cliente) => void;
}

const sinTildes = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Alta rápida de un cliente desde la cuenta que se está armando: sólo el nombre (y el teléfono si
// se lo tiene a mano), para no salir de la venta. El resto (deuda anterior, nota) se carga después
// desde "Clientes (fiado)".
export default function NuevoClienteRapido({ clientesExistentes, onCerrar, onCreado }: Props) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repetido = useMemo(() => {
    const buscado = sinTildes(nombre);
    return !!buscado && clientesExistentes.some((c) => sinTildes(c.nombre) === buscado);
  }, [nombre, clientesExistentes]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    // Está dentro de la pantalla de la cuenta: que este envío no llegue a nada más.
    e.stopPropagation();
    const limpio = nombre.trim();
    if (!limpio) {
      setError('Escribí el nombre del cliente');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const creado = await window.api.clientes.crear({ nombre: limpio, nota: null, telefono: telefono.trim() || null }, 0);
      onCreado(creado);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el cliente');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div
      data-nuevo-cliente-rapido
      className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-slate-900/40 p-4"
    >
      <div className="w-full max-w-sm animate-scale-in rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Cliente nuevo</h2>
          <p className="mt-0.5 text-xs text-slate-500">Se agrega a la lista de clientes y queda elegido para esta cuenta.</p>
        </div>
        <form onSubmit={guardar} className="space-y-4 px-5 py-4">
          <div>
            <label className="label" htmlFor="cliente-rapido-nombre">
              Nombre y apellido
            </label>
            <input
              id="cliente-rapido-nombre"
              className="input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              autoFocus
              required
            />
            {repetido && (
              <p className="mt-1 text-xs text-amber-600">
                Ya hay un cliente con ese nombre. Si es otra persona, agregale algo para distinguirla (el apellido o un apodo).
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="cliente-rapido-telefono">
              Teléfono (opcional)
            </label>
            <input
              id="cliente-rapido-telefono"
              className="input"
              type="tel"
              inputMode="tel"
              placeholder="Ej: 11 5555-1234"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Agregar cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
