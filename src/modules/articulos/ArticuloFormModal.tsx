import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ImagePlus, Barcode, Sparkles } from 'lucide-react';
import type { Articulo, ArticuloInput, Familia, Marca, SugerenciaRubro, UnidadVenta } from '@shared/types';
import { limpiarDecimal, numeroDeDecimal, redondearCantidad } from '@shared/formato';
import { useAuth } from '../auth/AuthContext';
import SelectConCrear from '../../components/SelectConCrear';
import { urlImagen } from '../../urlImagen';

interface Props {
  articulo: Articulo | null;
  /** Código de barras ya escaneado, para precargar el formulario de un artículo nuevo. */
  codigoInicial?: string;
  onCerrar: () => void;
  onGuardado: () => void;
}

const VACIO: ArticuloInput = {
  codigoBarras: '',
  descripcion: '',
  marcaId: null,
  familiaId: null,
  proveedorId: null,
  precioCosto: 0,
  precioVenta: 0,
  precioLista2: 0,
  precioLista3: 0,
  utilidadPct: 0,
  stock: 0,
  stockMinimo: 0,
  stockIdeal: 0,
  unidad: 'unidad',
  imagenPath: null,
  nota: '',
};

export default function ArticuloFormModal({ articulo, codigoInicial, onCerrar, onGuardado }: Props) {
  const { esAdmin } = useAuth();
  const [form, setForm] = useState<ArticuloInput>(
    articulo ? articuloAInput(articulo) : { ...VACIO, codigoBarras: codigoInicial ?? '' }
  );
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [mostrarPrecios23, setMostrarPrecios23] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoCodigoDuplicado, setAvisoCodigoDuplicado] = useState<string | null>(null);
  const [sugerenciaRubro, setSugerenciaRubro] = useState<SugerenciaRubro | null>(null);

  const descripcionRef = useRef<HTMLInputElement>(null);
  const codigoBarrasRef = useRef<HTMLInputElement>(null);

  // Si es un artículo nuevo y todavía no tiene código (no vino de un escaneo
  // previo), lo natural es escanear primero y recién después escribir el
  // nombre — así que el foco inicial va al código, no a la descripción.
  const enfocarCodigoPrimero = !articulo && !codigoInicial;

  useEffect(() => {
    window.api.familias.list().then(setFamilias);
    window.api.marcas.list().then(setMarcas);
  }, []);

  // Sugerencia de rubro: compara la descripción contra los artículos ya
  // cargados (sin ningún servicio de IA externo) y, si encuentra un rubro
  // distinto al elegido, muestra un chip para aplicarlo con un click.
  useEffect(() => {
    const descripcion = form.descripcion.trim();
    if (descripcion.length < 3) {
      setSugerenciaRubro(null);
      return;
    }
    let vigente = true;
    const debounce = setTimeout(() => {
      window.api.articulos.sugerirRubro(descripcion).then((sugerencia) => {
        if (vigente) setSugerenciaRubro(sugerencia);
      });
    }, 400);
    return () => {
      vigente = false;
      clearTimeout(debounce);
    };
  }, [form.descripcion]);

  // El lector de código de barras "tipea" los dígitos y al final manda un
  // Enter, como si fuera un teclado. Si eso pasa dentro de un <input> de un
  // formulario, el navegador lo interpreta como "enviar el formulario" — acá
  // lo evitamos siempre (salvo en la nota, donde Enter es un salto de línea
  // normal) y en el campo de código, en cambio, mandamos el foco a
  // Descripción para seguir cargando el producto sin sobresaltos.
  function handleFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (target === codigoBarrasRef.current) {
      descripcionRef.current?.focus();
    }
  }

  async function verificarCodigoDuplicado(codigo: string) {
    const codigoLimpio = codigo.trim();
    if (!codigoLimpio) {
      setAvisoCodigoDuplicado(null);
      return;
    }
    try {
      const encontrado = await window.api.articulos.buscarPorCodigo(codigoLimpio);
      if (encontrado && encontrado.id !== articulo?.id) {
        setAvisoCodigoDuplicado(`Ese código ya es de "${encontrado.descripcion}"`);
      } else {
        setAvisoCodigoDuplicado(null);
      }
    } catch {
      // Si falla la verificación no bloqueamos la carga; el guardado igual
      // valida el código único del lado del servidor.
    }
  }

  function actualizarCampo<K extends keyof ArticuloInput>(campo: K, valor: ArticuloInput[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  // Mientras el valor sea 0 (el default con el que arranca un artículo nuevo)
  // mostramos el cuadro vacío en vez de un "0" que hay que borrar antes de
  // poder escribir. En cuanto tipean algo, se ve el número real.
  function vacioSiCero(valor: number): number | string {
    return valor === 0 ? '' : valor;
  }

  // Campos de precio: número con decimales.
  function actualizarPrecio<K extends 'precioCosto' | 'precioVenta' | 'precioLista2' | 'precioLista3'>(
    campo: K,
    valorTexto: string
  ) {
    actualizarCampo(campo, (valorTexto === '' ? 0 : Number(valorTexto)) as ArticuloInput[K]);
  }

  function cambiarUnidad(unidad: UnidadVenta) {
    setForm((f) =>
      unidad === 'peso'
        ? { ...f, unidad }
        : {
            ...f,
            unidad,
            // Pasó a venderse por unidad: el stock no puede quedar con
            // decimales. (El stock actual de un artículo ya cargado no se
            // guarda desde acá — va por "Ajustar stock".)
            stock: articulo ? f.stock : Math.round(f.stock),
            stockMinimo: Math.round(f.stockMinimo),
            stockIdeal: Math.round(f.stockIdeal),
          }
    );
  }

  const porPeso = form.unidad === 'peso';

  const utilidadCalculada =
    form.precioCosto > 0 ? (((form.precioVenta - form.precioCosto) / form.precioCosto) * 100).toFixed(1) : '—';

  async function elegirImagen() {
    try {
      const ruta = await window.api.imagenes.seleccionar();
      if (ruta) actualizarCampo('imagenPath', ruta);
    } catch (err) {
      // Desde el celular no hay explorador de archivos de Windows para elegir
      // una foto — se lo avisamos así en vez de dejar la promesa sin manejar.
      alert(err instanceof Error ? err.message : 'No se pudo elegir la imagen');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.descripcion.trim()) {
      setError('La descripción es obligatoria');
      return;
    }
    setError(null);
    setGuardando(true);

    const utilidadPct =
      form.precioCosto > 0 ? Math.round(((form.precioVenta - form.precioCosto) / form.precioCosto) * 1000) / 10 : 0;
    const payload: ArticuloInput = {
      ...form,
      codigoBarras: form.codigoBarras?.trim() || null,
      descripcion: form.descripcion.trim(),
      utilidadPct,
    };

    try {
      if (articulo) {
        // Con cómo estaba al abrir el formulario: así no se pisa lo que otra
        // persona haya cambiado mientras tanto (ver actualizarArticulo).
        await window.api.articulos.actualizar(articulo.id, payload, articuloAInput(articulo));
      } else {
        await window.api.articulos.crear(payload);
      }
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el artículo');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90dvh] w-full max-w-3xl animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">
            {articulo ? 'Editar artículo' : 'Nuevo artículo'}
          </h2>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          id="articulo-form"
          onSubmit={handleSubmit}
          onKeyDown={handleFormKeyDown}
          className="flex-1 overflow-y-auto px-6 py-5"
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[140px_1fr]">
            <div>
              <label className="label">Imagen</label>
              <button
                type="button"
                onClick={elegirImagen}
                className="flex h-28 w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100"
              >
                {form.imagenPath ? (
                  <img src={urlImagen(form.imagenPath)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-slate-300" />
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="descripcion">
                  Descripción *
                </label>
                <input
                  ref={descripcionRef}
                  id="descripcion"
                  className="input"
                  value={form.descripcion}
                  onChange={(e) => actualizarCampo('descripcion', e.target.value)}
                  required
                  autoFocus={!enfocarCodigoPrimero}
                />
              </div>

              <div>
                <label className="label" htmlFor="codigoBarras">
                  Código de barras
                </label>
                <div className="relative">
                  <Barcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={codigoBarrasRef}
                    id="codigoBarras"
                    className="input pl-9"
                    value={form.codigoBarras ?? ''}
                    onChange={(e) => {
                      actualizarCampo('codigoBarras', e.target.value);
                      setAvisoCodigoDuplicado(null);
                    }}
                    onBlur={(e) => verificarCodigoDuplicado(e.target.value)}
                    placeholder="Escaneá o escribí el código"
                    autoFocus={enfocarCodigoPrimero}
                  />
                </div>
                {avisoCodigoDuplicado && (
                  <p className="mt-1 text-xs font-medium text-amber-600">{avisoCodigoDuplicado}</p>
                )}
              </div>

              <div>
                <label className="label" htmlFor="unidad">
                  Se vende por
                </label>
                <select
                  id="unidad"
                  className="input"
                  value={form.unidad}
                  onChange={(e) => cambiarUnidad(e.target.value as UnidadVenta)}
                >
                  <option value="unidad">Unidad</option>
                  <option value="peso">Peso (kg)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <SelectConCrear
                label="Familia / Rubro"
                opciones={familias}
                valor={form.familiaId}
                onCambiar={(id) => {
                  actualizarCampo('familiaId', id);
                  setSugerenciaRubro(null);
                }}
                onCrear={async (nombre) => {
                  const nueva = await window.api.familias.crear(nombre);
                  setFamilias((f) => [...f, nueva].sort((a, b) => a.nombre.localeCompare(b.nombre)));
                  return nueva;
                }}
              />
              {sugerenciaRubro && sugerenciaRubro.familiaId !== form.familiaId && (
                <button
                  type="button"
                  onClick={() => {
                    actualizarCampo('familiaId', sugerenciaRubro.familiaId);
                    setSugerenciaRubro(null);
                  }}
                  className="mt-1.5 flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
                  title="Basado en artículos parecidos que ya tenés cargados"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Sugerencia: {sugerenciaRubro.familiaNombre}
                </button>
              )}
            </div>
            <SelectConCrear
              label="Marca"
              opciones={marcas}
              valor={form.marcaId}
              onCambiar={(id) => actualizarCampo('marcaId', id)}
              onCrear={async (nombre) => {
                const nueva = await window.api.marcas.crear(nombre);
                setMarcas((m) => [...m, nueva].sort((a, b) => a.nombre.localeCompare(b.nombre)));
                return nueva;
              }}
            />
          </div>

          <hr className="my-5 border-slate-200" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="precioCosto">
                Precio de costo {!esAdmin && <span className="text-slate-300">(solo jefa)</span>}
              </label>
              <input
                id="precioCosto"
                type="number"
                step="0.01"
                min="0"
                className="input disabled:bg-slate-50"
                value={vacioSiCero(form.precioCosto)}
                onChange={(e) => actualizarPrecio('precioCosto', e.target.value)}
                placeholder="0"
                disabled={!esAdmin}
              />
            </div>
            <div>
              <label className="label" htmlFor="precioVenta">
                Precio de venta *
              </label>
              <input
                id="precioVenta"
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={vacioSiCero(form.precioVenta)}
                onChange={(e) => actualizarPrecio('precioVenta', e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div>
              <label className="label">Utilidad</label>
              <div className="input flex items-center bg-slate-50 text-slate-500">
                {utilidadCalculada}
                {utilidadCalculada !== '—' && '%'}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="mt-3 text-xs font-medium text-brand-600 hover:underline"
            onClick={() => setMostrarPrecios23((v) => !v)}
          >
            {mostrarPrecios23 ? 'Ocultar' : 'Agregar'} listas de precios 2 y 3
          </button>

          {mostrarPrecios23 && (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Precio lista 2</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={vacioSiCero(form.precioLista2)}
                  onChange={(e) => actualizarPrecio('precioLista2', e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label">Precio lista 3</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={vacioSiCero(form.precioLista3)}
                  onChange={(e) => actualizarPrecio('precioLista3', e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
          )}

          <hr className="my-5 border-slate-200" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="stock">
                Stock actual {porPeso && '(kg)'}
              </label>
              <CampoStock
                id="stock"
                valor={form.stock}
                porPeso={porPeso}
                onCambiar={(n) => actualizarCampo('stock', n)}
                disabled={!!articulo}
                title={articulo ? 'Para modificar el stock existente usá "Ajustar stock" en el listado' : undefined}
              />
            </div>
            <div>
              <label className="label" htmlFor="stockMinimo">
                Stock mínimo {porPeso && '(kg)'}
              </label>
              <CampoStock
                id="stockMinimo"
                valor={form.stockMinimo}
                porPeso={porPeso}
                onCambiar={(n) => actualizarCampo('stockMinimo', n)}
              />
            </div>
            <div>
              <label className="label" htmlFor="stockIdeal">
                Stock ideal {porPeso && '(kg)'}
              </label>
              <CampoStock
                id="stockIdeal"
                valor={form.stockIdeal}
                porPeso={porPeso}
                onCambiar={(n) => actualizarCampo('stockIdeal', n)}
              />
            </div>
          </div>

          <div className="mt-5">
            <label className="label" htmlFor="nota">
              Nota interna
            </label>
            <textarea
              id="nota"
              className="input"
              rows={2}
              value={form.nota ?? ''}
              onChange={(e) => actualizarCampo('nota', e.target.value)}
            />
          </div>

          {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" className="btn-secondary" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" form="articulo-form" className="btn-primary" disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function textoDeStock(valor: number): string {
  return valor === 0 ? '' : String(valor).replace('.', ',');
}

// Campo de stock: sólo enteros si se vende por unidad (no tiene sentido
// "3,5 unidades" en el depósito) y kilos con decimales si se vende por peso
// — antes ni siquiera se podía cargar "2,5 kg". Guarda el texto tal como se
// escribe: si guardara sólo el número, al tipear "2," quedaría en 2 y se
// comería la coma antes de poder poner los decimales.
function CampoStock({
  id,
  valor,
  porPeso,
  onCambiar,
  disabled,
  title,
}: {
  id: string;
  valor: number;
  porPeso: boolean;
  onCambiar: (valor: number) => void;
  disabled?: boolean;
  title?: string;
}) {
  const [texto, setTexto] = useState(() => textoDeStock(valor));

  // Si el número cambia desde afuera (ej. se pasó de "Peso" a "Unidad" y se
  // redondeó), se refleja en el cuadro.
  useEffect(() => {
    setTexto((actual) => (numeroDeDecimal(actual) === valor ? actual : textoDeStock(valor)));
  }, [valor]);

  return (
    <input
      id={id}
      inputMode={porPeso ? 'decimal' : 'numeric'}
      className="input disabled:bg-slate-50"
      value={texto}
      onChange={(e) => {
        const limpio = porPeso ? limpiarDecimal(e.target.value) : e.target.value.replace(/[^0-9]/g, '');
        setTexto(limpio);
        onCambiar(redondearCantidad(numeroDeDecimal(limpio)));
      }}
      placeholder="0"
      disabled={disabled}
      title={title}
    />
  );
}

function articuloAInput(a: Articulo): ArticuloInput {
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
