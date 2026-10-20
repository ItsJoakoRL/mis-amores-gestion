import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Articulo, ItemDeuda } from '@shared/types';
import { formatearMonedaConCentavos, parsearMonto } from '@shared/formato';
import { subtotalDeItem, totalDeItems } from '@shared/cuentaCorriente';

// La lista de productos de una deuda anotada a mano (lo que estaba en el cuaderno): cada fila
// es un producto con su cantidad y su precio. Se puede elegir del catálogo (trae el precio) o
// escribir cualquier cosa, y el total es lo que suman.

export interface FilaProducto {
  clave: number;
  descripcion: string;
  cantidad: string;
  precio: string;
}

let proximaClave = 1;
export function filaNueva(): FilaProducto {
  return { clave: proximaClave++, descripcion: '', cantidad: '1', precio: '' };
}

const estaVacia = (f: FilaProducto) => f.descripcion.trim() === '' && f.precio.trim() === '';

/** Lo que dicen las filas: los productos ya listos, cuánto suman y cuántas filas están a
 * medio llenar (las que están totalmente vacías no cuentan). */
export function resumenDeFilas(filas: FilaProducto[]): { items: ItemDeuda[]; total: number; incompletas: number } {
  const items: ItemDeuda[] = [];
  let incompletas = 0;
  for (const f of filas) {
    if (estaVacia(f)) continue;
    const cantidad = parsearMonto(f.cantidad);
    const precio = parsearMonto(f.precio);
    if (!f.descripcion.trim() || !(cantidad > 0) || !Number.isFinite(cantidad) || !Number.isFinite(precio) || precio < 0) {
      incompletas += 1;
      continue;
    }
    items.push({ descripcion: f.descripcion.trim(), cantidad, precioUnitario: precio });
  }
  return { items, total: totalDeItems(items), incompletas };
}

const aTexto = (n: number) => String(n).replace('.', ',');

function Fila({
  fila,
  onCambio,
  onQuitar,
  puedeQuitar,
}: {
  fila: FilaProducto;
  onCambio: (cambios: Partial<FilaProducto>) => void;
  onQuitar: () => void;
  puedeQuitar: boolean;
}) {
  const [sugerencias, setSugerencias] = useState<Articulo[]>([]);
  const [abierta, setAbierta] = useState(false);
  // Lo último que se eligió de la lista: no hace falta volver a buscarlo.
  const elegido = useRef<string | null>(null);

  useEffect(() => {
    const texto = fila.descripcion.trim();
    if (texto.length < 2 || texto === elegido.current) {
      setSugerencias([]);
      return;
    }
    let vigente = true;
    const t = setTimeout(() => {
      window.api.articulos
        .list({ busqueda: texto })
        .then((lista) => vigente && setSugerencias(lista.filter((a) => a.activo).slice(0, 6)))
        .catch(() => vigente && setSugerencias([]));
    }, 220);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [fila.descripcion]);

  function elegir(a: Articulo) {
    elegido.current = a.descripcion;
    onCambio({ descripcion: a.descripcion, precio: a.precioVenta > 0 ? aTexto(a.precioVenta) : fila.precio });
    setSugerencias([]);
    setAbierta(false);
  }

  const cantidad = parsearMonto(fila.cantidad);
  const precio = parsearMonto(fila.precio);
  const subtotal = cantidad > 0 && Number.isFinite(precio) ? subtotalDeItem({ cantidad, precioUnitario: precio }) : null;

  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto_auto] items-start gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_5.5rem_auto]">
      <div className="relative col-span-4 sm:col-span-1">
        <input
          className="input"
          placeholder="Producto (escribí o elegí del catálogo)"
          maxLength={120}
          value={fila.descripcion}
          onChange={(e) => {
            elegido.current = null;
            onCambio({ descripcion: e.target.value });
            setAbierta(true);
          }}
          onFocus={() => setAbierta(true)}
          onBlur={() => setTimeout(() => setAbierta(false), 120)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault(); // acá Enter no guarda todo: elige el primero de la lista, si hay
            if (abierta && sugerencias[0]) elegir(sugerencias[0]);
          }}
        />
        {abierta && sugerencias.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-surface py-1 shadow-lg">
            {sugerencias.map((a) => (
              <button
                key={a.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(a)}
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <span className="truncate text-slate-700">{a.descripcion}</span>
                <span className="shrink-0 text-xs text-slate-400">{formatearMonedaConCentavos(a.precioVenta)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        className="input"
        inputMode="decimal"
        aria-label="Cantidad"
        placeholder="Cant."
        value={fila.cantidad}
        onChange={(e) => onCambio({ cantidad: e.target.value.replace(/[^0-9.,]/g, '') })}
      />
      <input
        className="input"
        inputMode="decimal"
        aria-label="Precio de cada uno"
        placeholder="Precio c/u"
        value={fila.precio}
        onChange={(e) => onCambio({ precio: e.target.value.replace(/[^0-9.,]/g, '') })}
      />
      <p className="flex h-[38px] min-w-[5.5rem] items-center justify-end text-sm font-medium text-slate-600 sm:min-w-0 sm:justify-start">
        {subtotal === null ? <span className="text-slate-300">—</span> : formatearMonedaConCentavos(subtotal)}
      </p>
      <button
        type="button"
        onClick={onQuitar}
        disabled={!puedeQuitar}
        className="flex h-[38px] w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300"
        title="Sacar este producto"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function EditorDeProductos({
  filas,
  onChange,
}: {
  filas: FilaProducto[];
  onChange: (filas: FilaProducto[]) => void;
}) {
  const { items, total, incompletas } = resumenDeFilas(filas);

  return (
    <div className="space-y-2">
      {filas.map((f) => (
        <Fila
          key={f.clave}
          fila={f}
          puedeQuitar={filas.length > 1}
          onCambio={(cambios) => onChange(filas.map((x) => (x.clave === f.clave ? { ...x, ...cambios } : x)))}
          onQuitar={() => onChange(filas.filter((x) => x.clave !== f.clave))}
        />
      ))}
      <button
        type="button"
        onClick={() => onChange([...filas, filaNueva()])}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
      >
        <Plus className="h-4 w-4" />
        Agregar otro producto
      </button>
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <span className="text-slate-500">
          {items.length} producto{items.length === 1 ? '' : 's'}
          {incompletas > 0 && (
            <span className="ml-2 text-amber-700">
              · {incompletas} sin terminar de completar
            </span>
          )}
        </span>
        <span className="font-semibold text-slate-800">Total {formatearMonedaConCentavos(total)}</span>
      </div>
    </div>
  );
}
