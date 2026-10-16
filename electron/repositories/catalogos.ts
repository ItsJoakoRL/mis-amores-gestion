// Repositorio para las colecciones "chicas" de catálogo: familias, marcas y proveedores.
import { ObjectId } from 'mongodb';
import { getDb } from '../db/database';
import type { Familia, Marca, Proveedor } from '../../shared/types';

function esErrorDuplicado(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// Un nombre vacío (o algo que no es texto) no puede quedar guardado: después no
// se vería en las listas.
function nombreValido(nombre: unknown, deQue: string): string {
  if (typeof nombre !== 'string' || !nombre.trim()) throw new Error(`Escribí el nombre ${deQue}`);
  return nombre.trim();
}

function textoOpcional(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

// --- Familias ---

interface FamiliaDoc {
  _id: ObjectId;
  nombre: string;
}

export async function listFamilias(): Promise<Familia[]> {
  const docs = await getDb().collection<FamiliaDoc>('familias').find().sort({ nombre: 1 }).toArray();
  return docs.map((d) => ({ id: d._id.toHexString(), nombre: d.nombre }));
}

export async function crearFamilia(nombre: string): Promise<Familia> {
  const nombreLimpio = nombreValido(nombre, 'del rubro');
  try {
    const result = await getDb().collection<FamiliaDoc>('familias').insertOne({ nombre: nombreLimpio } as FamiliaDoc);
    return { id: result.insertedId.toHexString(), nombre: nombreLimpio };
  } catch (err) {
    if (esErrorDuplicado(err)) throw new Error('Ya existe un rubro con ese nombre');
    throw err;
  }
}

// --- Marcas ---

interface MarcaDoc {
  _id: ObjectId;
  nombre: string;
}

export async function listMarcas(): Promise<Marca[]> {
  const docs = await getDb().collection<MarcaDoc>('marcas').find().sort({ nombre: 1 }).toArray();
  return docs.map((d) => ({ id: d._id.toHexString(), nombre: d.nombre }));
}

export async function crearMarca(nombre: string): Promise<Marca> {
  const nombreLimpio = nombreValido(nombre, 'de la marca');
  try {
    const result = await getDb().collection<MarcaDoc>('marcas').insertOne({ nombre: nombreLimpio } as MarcaDoc);
    return { id: result.insertedId.toHexString(), nombre: nombreLimpio };
  } catch (err) {
    if (esErrorDuplicado(err)) throw new Error('Ya existe una marca con ese nombre');
    throw err;
  }
}

// --- Proveedores ---

interface ProveedorDoc {
  _id: ObjectId;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
}

export async function listProveedores(): Promise<Proveedor[]> {
  const docs = await getDb().collection<ProveedorDoc>('proveedores').find().sort({ nombre: 1 }).toArray();
  return docs.map((d) => ({
    id: d._id.toHexString(),
    nombre: d.nombre,
    contacto: d.contacto ?? null,
    telefono: d.telefono ?? null,
    email: d.email ?? null,
  }));
}

export async function crearProveedor(data: Omit<Proveedor, 'id'>): Promise<Proveedor> {
  // Sólo los campos conocidos, ya limpios: antes se guardaba el pedido tal cual.
  const limpio = {
    nombre: nombreValido(data?.nombre, 'del proveedor'),
    contacto: textoOpcional(data?.contacto),
    telefono: textoOpcional(data?.telefono),
    email: textoOpcional(data?.email),
  };
  const result = await getDb()
    .collection<ProveedorDoc>('proveedores')
    .insertOne({ ...limpio } as ProveedorDoc);
  return { id: result.insertedId.toHexString(), ...limpio };
}
