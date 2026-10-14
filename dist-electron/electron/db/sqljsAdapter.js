"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppDatabase = void 0;
exports.openDatabase = openDatabase;
// Capa fina que envuelve sql.js (SQLite compilado a WebAssembly) para que el
// resto del código (electron/repositories/*) pueda usarlo con la misma forma
// de API que better-sqlite3 (.prepare().run()/.get()/.all(), .exec(), .transaction()).
//
// Se eligió sql.js en lugar de better-sqlite3 porque no requiere compilar un
// módulo nativo (node-gyp / Visual Studio Build Tools) para funcionar: esta PC
// no tiene el toolchain de C++ instalado. La contra es que sql.js vive en
// memoria, así que cada cambio se persiste a disco explícitamente (ver
// `scheduleSave` más abajo).
const fs_1 = __importDefault(require("fs"));
const sql_js_1 = __importDefault(require("sql.js"));
function normalizeParams(args) {
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
        const obj = args[0];
        const bound = {};
        for (const [key, value] of Object.entries(obj)) {
            bound[`@${key}`] = value === undefined ? null : (value ?? null);
            // También registramos con ':' por si alguna consulta usa ese estilo.
        }
        return bound;
    }
    return args.map((v) => (v === undefined ? null : v));
}
class Statement {
    constructor(db, sql, onWrite) {
        this.db = db;
        this.sql = sql;
        this.onWrite = onWrite;
    }
    run(...args) {
        const stmt = this.db.prepare(this.sql);
        try {
            stmt.bind(normalizeParams(args));
            stmt.step();
        }
        finally {
            stmt.free();
        }
        this.onWrite();
        const idRow = this.db.exec('SELECT last_insert_rowid() AS id');
        const lastInsertRowid = idRow.length > 0 ? Number(idRow[0].values[0][0]) : 0;
        return { lastInsertRowid, changes: this.db.getRowsModified() };
    }
    get(...args) {
        const stmt = this.db.prepare(this.sql);
        try {
            stmt.bind(normalizeParams(args));
            if (stmt.step()) {
                return stmt.getAsObject();
            }
            return undefined;
        }
        finally {
            stmt.free();
        }
    }
    all(...args) {
        const stmt = this.db.prepare(this.sql);
        const rows = [];
        try {
            stmt.bind(normalizeParams(args));
            while (stmt.step()) {
                rows.push(stmt.getAsObject());
            }
            return rows;
        }
        finally {
            stmt.free();
        }
    }
}
class AppDatabase {
    constructor(sqljs, filePath) {
        this.sqljs = sqljs;
        this.filePath = filePath;
        this.dirty = false;
        this.saveTimer = null;
    }
    prepare(sql) {
        return new Statement(this.sqljs, sql, () => this.markDirtyAndScheduleSave());
    }
    exec(sql) {
        this.sqljs.exec(sql);
        this.markDirtyAndScheduleSave();
    }
    pragma(_sql) {
        // sql.js no soporta todos los PRAGMA de SQLite completo (ej. WAL, que es
        // un modo de archivo en disco que no aplica a una base en memoria); lo
        // ignoramos silenciosamente, no afecta la correctitud de las consultas.
    }
    transaction(fn) {
        const wrapped = ((...args) => {
            const resultado = fn(...args);
            this.markDirtyAndScheduleSave();
            return resultado;
        });
        return wrapped;
    }
    markDirtyAndScheduleSave() {
        this.dirty = true;
        if (this.saveTimer)
            return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.flush();
        }, 250);
    }
    /** Escribe el estado actual de la base a disco de forma inmediata. */
    flush() {
        if (!this.dirty)
            return;
        const data = this.sqljs.export();
        fs_1.default.writeFileSync(this.filePath, data);
        this.dirty = false;
    }
}
exports.AppDatabase = AppDatabase;
let sqlJsStaticPromise = null;
function getSqlJsStatic() {
    if (!sqlJsStaticPromise) {
        const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
        const wasmBytes = fs_1.default.readFileSync(wasmPath);
        const wasmBinary = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength);
        sqlJsStaticPromise = (0, sql_js_1.default)({ wasmBinary });
    }
    return sqlJsStaticPromise;
}
async function openDatabase(filePath) {
    const SQL = await getSqlJsStatic();
    const existe = fs_1.default.existsSync(filePath);
    const sqljs = existe ? new SQL.Database(fs_1.default.readFileSync(filePath)) : new SQL.Database();
    const app = new AppDatabase(sqljs, filePath);
    if (!existe) {
        // Aseguramos que el archivo exista desde el arranque.
        app.exec('PRAGMA user_version = 1');
        app.flush();
    }
    return app;
}
