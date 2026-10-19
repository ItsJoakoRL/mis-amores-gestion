import type React from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Articulo } from '@shared/types';
import { formatearCantidad, limpiarDecimal, numeroDeDecimal } from '@shared/formato';

interface Props {
  articulo: Articulo;
  onCerrar: () => void;
  onGuardado: () => void;
}

type Tipo = 'ingreso' | 'egreso' | 'ajuste';

export default function AjustarStockModal({ articulo, onCerrar, onGuardado }: Props) {
  const [tipo, setTipo] = useState<Tipo>('ingreso');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Por unidad, sólo enteros (no hay "3,5 unidades" en el depósito); por
  // peso, kilos con decimales — antes tampoco se podía cargar "2,5 kg",
  // aunque al vender sí se descontaran fracciones.
  const porPeso = articulo.unidad === 'peso';
  const unidadTexto = porPeso ? 'kg' : 'un.';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = numeroDeDecimal(cantidad);
    if (cantidad.trim() === '' || (tipo !== 'ajuste' && num <= 0)) {
      setError('Ingresá una cantidad válida');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await window.api.articulos.ajustarStock(articulo.id, num, tipo, motivo.trim() || null);
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo ajustar el stock');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm animate-scale-in rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Ajustar stock</h2>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <p className="text-sm text-slate-500">
            {articulo.descripcion} — Stock actual:{' '}
            <strong>
              {formatearCantidad(articulo.stock)} {unidadTexto}
            </strong>
          </p>

          <div>
            <label className="label">Tipo de movimiento</label>
            <div data-tour="stock-tipo" className="grid grid-cols-3 gap-1.5">
              {(['ingreso', 'egreso', 'ajuste'] as Tipo[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={`rounded-lg border px-2 py-1.5 text-sm capitalize ${
                    tipo === t
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="cantidad">
              {tipo === 'ajuste' ? 'Nuevo stock total' : 'Cantidad'} {porPeso && '(kg)'}
            </label>
            <input
              id="cantidad"
              inputMode={porPeso ? 'decimal' : 'numeric'}
              className="input"
              value={cantidad}
              onChange={(e) =>
                setCantidad(porPeso ? limpiarDecimal(e.target.value) : e.target.value.replace(/[^0-9]/g, ''))
              }
              placeholder={porPeso ? '0,000' : '0'}
              autoFocus
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="motivo">
              Motivo (opcional)
            </label>
            <input
              id="motivo"
              className="input"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: compra a proveedor, rotura, conteo físico..."
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onCerrar}>
              Cancelar
            </button>
            <button data-tour="stock-confirmar" type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
