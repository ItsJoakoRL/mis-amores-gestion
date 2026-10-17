import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Barcode, Loader2 } from 'lucide-react';
import type { Articulo, ArticuloInput } from '@shared/types';
import { formatearMoneda } from '@shared/formato';

interface Props {
  /** Código escaneado que no coincidió con ningún artículo. */
  codigo: string;
  onCerrar: () => void;
  /** Recibe el artículo ya con el código asignado (en el mostrador se lo suma a la cuenta). */
  onAsignado: (articulo: Articulo) => void;
  /** El usuario prefiere cargarlo como artículo nuevo en vez de buscar uno existente. */
  onCrearNuevo: () => void;
}

function aInput(a: Articulo): ArticuloInput {
  return {
    codigoBarras: a.codigoBarras,
    descripcion: a.descripcion,
    marcaId: a.marcaId,
    familiaId: a.familiaId,
    proveedorId: a.proveedorId,
    precioCosto: a.precioCosto,
    precioVenta: a.precioVenta,
    precioLista2: a.precioLista2,
    precioLista3: a.precioLista3,
    utilidadPct: a.utilidadPct,
    stock: a.stock,
    stockMinimo: a.stockMinimo,
    stockIdeal: a.stockIdeal,
    unidad: a.unidad,
    imagenPath: a.imagenPath,
    nota: a.nota,
  };
}


// Muchos artículos del catálogo viejo entraron sin código de barras (ver
// memoria del proyecto) — la idea es cargarlo recién cuando aparece por
// primera vez en el lector, en vez de inventar uno. Este modal es ese
// atajo: buscás el artículo ya existente y le asignás el código escaneado.
export default function AsignarCodigoModal({ codigo, onCerrar, onAsignado, onCrearNuevo }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Articulo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [asignandoId, setAsignandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busqueda.trim()) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    // Una respuesta vieja (WiFi lenta) no tiene que pisar la de la última búsqueda.
    let vigente = true;
    const debounce = setTimeout(() => {
      window.api.articulos
        .list({ busqueda })
        // Primero los que no tienen código: casi siempre es uno de ésos.
        .then((lista) => {
          if (vigente) setResultados([...lista].sort((a, b) => Number(!!a.codigoBarras) - Number(!!b.codigoBarras)));
        })
        .catch((err) => {
          if (vigente) setError(err instanceof Error ? err.message : 'No se pudo buscar');
        })
        .finally(() => {
          if (vigente) setBuscando(false);
        });
    }, 200);
    return () => {
      vigente = false;
      clearTimeout(debounce);
    };
  }, [busqueda]);

  async function asignar(articulo: Articulo) {
    if (
      articulo.codigoBarras &&
      !confirm(`"${articulo.descripcion}" ya tiene el código ${articulo.codigoBarras}. ¿Reemplazarlo por ${codigo}?`)
    ) {
      return;
    }
    setAsignandoId(articulo.id);
    setError(null);
    try {
      // Sólo cambia el código: el resto queda como esté ahora en la base,
      // aunque alguien lo haya editado desde que se cargó esta lista.
      const actualizado = await window.api.articulos.actualizar(
        articulo.id,
        { ...aInput(articulo), codigoBarras: codigo },
        aInput(articulo)
      );
      onAsignado(actualizado);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo asignar el código');
      setAsignandoId(null);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-800">Código sin asignar</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <Barcode className="h-3.5 w-3.5" />
              {codigo}
            </p>
          </div>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="mb-3 text-sm text-slate-500">
            Este código no corresponde a ningún artículo. Buscá el artículo al que le pertenece para asignárselo, o
            cargalo como uno nuevo.
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Buscá por descripción..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {buscando && <p className="px-3 py-2 text-xs text-slate-400">Buscando...</p>}
          {!buscando && busqueda.trim() && resultados.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">Ningún artículo coincide con esa búsqueda.</p>
          )}
          {!buscando &&
            resultados.map((a) => (
              <button
                key={a.id}
                onClick={() => asignar(a)}
                disabled={asignandoId !== null}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                <span>
                  <span className="text-slate-700">{a.descripcion}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    {a.codigoBarras ? `Código actual: ${a.codigoBarras}` : 'Sin código'}
                  </span>
                </span>
                {asignandoId === a.id ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-500" />
                ) : (
                  <span className="shrink-0 text-xs text-slate-400">{formatearMoneda(a.precioVenta)}</span>
                )}
              </button>
            ))}
        </div>

        {error && <p className="mx-5 mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" className="btn-secondary" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={onCrearNuevo}>
            Crear artículo nuevo con este código
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
