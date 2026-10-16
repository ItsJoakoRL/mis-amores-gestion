import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

// Un campo de contraseña con un ojito para verla mientras se escribe: así se
// puede comprobar que quedó bien (sobre todo al cambiarla o al crear una cuenta).
// Recibe lo mismo que un <input> común (value, onChange, minLength, etc.).
export default function CampoContrasena({ className = 'input', ...props }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        // En el celular, un campo de texto común le pone mayúscula a la primera
        // letra y "corrige" lo que se escribe: con la contraseña a la vista eso
        // la cambiaba sin que se note.
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        {...props}
        type={visible ? 'text' : 'password'}
        className={`${className} pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Que apretarlo no le saque el foco al campo.
        onMouseDown={(e) => e.preventDefault()}
        aria-label={visible ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
        title={visible ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
      >
        {/* El ícono muestra cómo está ahora: ojo tachado = oculta, ojo abierto = se ve. */}
        {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>
    </div>
  );
}
