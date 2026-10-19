import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import CentroDeAyuda from './CentroDeAyuda';
import RecorridoAyuda, { type PasoRecorrido } from './RecorridoAyuda';
import { guiaPorId } from './guias';

interface Ayuda {
  /** Abre el centro de ayuda. Con el nombre de la pantalla ("Clientes (fiado)"), muestra primero lo de esa pantalla. */
  abrirCentro: (seccion?: string) => void;
  /** Arranca una guía paso a paso sobre la pantalla real. */
  iniciarRecorrido: (pasos: PasoRecorrido[], titulo?: string) => void;
  /** Arranca una guía del centro de ayuda por su id ("cobrar-venta"). */
  iniciarGuia: (id: string) => void;
}

const Contexto = createContext<Ayuda | null>(null);

export function useAyuda(): Ayuda {
  const a = useContext(Contexto);
  if (!a) throw new Error('useAyuda se usa dentro de <AyudaProvider>');
  return a;
}

// Maneja las dos cosas de la ayuda que se ven por encima de cualquier pantalla: el centro de
// ayuda (la lista de "¿qué querés hacer?") y la guía paso a paso. Vive en el Layout, así
// están disponibles desde todas las pantallas y la guía puede llevar de una a otra sin
// perderse.
export function AyudaProvider({ children }: { children: ReactNode }) {
  const [centro, setCentro] = useState<{ abierto: boolean; seccion?: string }>({ abierto: false });
  const [recorrido, setRecorrido] = useState<{ pasos: PasoRecorrido[]; titulo?: string; id: number } | null>(null);
  const contador = useRef(0);

  const abrirCentro = useCallback((seccion?: string) => setCentro({ abierto: true, seccion }), []);
  const iniciarRecorrido = useCallback((pasos: PasoRecorrido[], titulo?: string) => {
    if (pasos.length === 0) return;
    contador.current += 1;
    setCentro((c) => ({ ...c, abierto: false }));
    setRecorrido({ pasos, titulo, id: contador.current });
  }, []);
  const iniciarGuia = useCallback(
    (id: string) => {
      const guia = guiaPorId(id);
      if (guia) iniciarRecorrido(guia.pasos, guia.titulo);
    },
    [iniciarRecorrido]
  );

  const valor = useMemo(() => ({ abrirCentro, iniciarRecorrido, iniciarGuia }), [abrirCentro, iniciarRecorrido, iniciarGuia]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {centro.abierto && (
        <CentroDeAyuda
          seccion={centro.seccion}
          onCerrar={() => setCentro({ abierto: false })}
          onIniciarGuia={iniciarGuia}
          onIniciarRecorrido={iniciarRecorrido}
        />
      )}
      {recorrido && (
        <RecorridoAyuda
          key={recorrido.id}
          pasos={recorrido.pasos}
          titulo={recorrido.titulo}
          onCerrar={() => setRecorrido(null)}
        />
      )}
    </Contexto.Provider>
  );
}
