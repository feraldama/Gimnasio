// Middleware de permisos: es la capa que decide si un request pasa o no, así
// que un error acá o abre el sistema o deja al mostrador sin poder trabajar.
//
// Los tests reemplazan `db.query` por una tabla de permisos en memoria: se
// ejercita el middleware REAL (su SQL, su armado de parámetros, su manejo de
// respuestas) sin depender de la base.
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// Inyectamos el doble de `config/db` en la caché de módulos ANTES de cargar el
// middleware. Sin esto, requerir el módulo real abre el pool de Postgres y el
// proceso de test queda vivo hasta que expira `idleTimeoutMillis` (60 s).
const rutaDb = require.resolve("../config/db");
require.cache[rutaDb] = {
  id: rutaDb,
  filename: rutaDb,
  loaded: true,
  exports: { query: (...args) => stubQuery(...args) },
};

const requirePerm = require("../middlewares/permission");
const { requireAnyPerm } = requirePerm;

// Permisos simulados: set de "RECURSO:columnaFlag".
let permisos = new Set();
let ultimaConsulta = null;
let forzarError = null;

// Interpreta el SQL del middleware contra `permisos`. Lee los flags del propio
// SQL y los recursos de los parámetros, así que si el middleware cambia su
// consulta, esta simulación lo refleja en vez de esconderlo.
function stubQuery(sql, params, cb) {
  ultimaConsulta = { sql, params };
  if (forzarError) return cb(forzarError);
  const usuarioId = params[0];
  const recursos = params.slice(1);
  const flags = [...sql.matchAll(/pm\.(puede\w+) = 1/g)].map((m) => m[1]);
  assert.ok(usuarioId, "el middleware debe pasar el id de usuario");
  assert.ok(flags.length, "el middleware debe filtrar por algún flag");
  const permite = recursos.some((r) =>
    flags.some((f) => permisos.has(`${r}:${f}`))
  );
  cb(null, permite ? [{ ok: 1 }] : []);
}

// Corre un middleware y devuelve { status, body } o { status: 200 } si llamó next().
function ejecutar(mw, user) {
  return new Promise((resolve) => {
    const res = {
      status: (code) => ({ json: (body) => resolve({ status: code, body }) }),
    };
    mw({ user }, res, () => resolve({ status: 200 }));
  });
}

const NO_ADMIN = { id: "cajero", isAdmin: "N" };

beforeEach(() => {
  permisos = new Set();
  ultimaConsulta = null;
  forzarError = null;
});

describe("requirePerm", () => {
  test("permite cuando el perfil tiene el flag exacto", async () => {
    permisos.add("PAGOS:puedeLeer");
    const r = await ejecutar(requirePerm("PAGOS", "leer"), NO_ADMIN);
    assert.equal(r.status, 200);
  });

  test("niega con 403 cuando no tiene el flag", async () => {
    const r = await ejecutar(requirePerm("PAGOS", "leer"), NO_ADMIN);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "FORBIDDEN");
  });

  test("el flag de leer NO habilita eliminar", async () => {
    // Es el caso que motivó el middleware: la UI escondía el botón de borrar
    // pero el backend dejaba pasar un DELETE por curl.
    permisos.add("PAGOS:puedeLeer");
    const r = await ejecutar(requirePerm("PAGOS", "eliminar"), NO_ADMIN);
    assert.equal(r.status, 403);
  });

  test("el permiso sobre un recurso no se filtra a otro", async () => {
    permisos.add("COMPRAS:puedeLeer");
    const r = await ejecutar(requirePerm("PAGOS", "leer"), NO_ADMIN);
    assert.equal(r.status, 403);
  });

  test("acepta un array de acciones y alcanza con tener una", async () => {
    permisos.add("USUARIOS:puedeCrear");
    const r = await ejecutar(
      requirePerm("USUARIOS", ["crear", "editar"]),
      NO_ADMIN
    );
    assert.equal(r.status, 200);
  });

  test("con array de acciones, no tener ninguna sigue siendo 403", async () => {
    permisos.add("USUARIOS:puedeLeer");
    const r = await ejecutar(
      requirePerm("USUARIOS", ["crear", "editar"]),
      NO_ADMIN
    );
    assert.equal(r.status, 403);
  });

  test("rechaza una acción inválida al construirse, no en runtime", () => {
    // Falla al cargar el router (arranque) en vez de dar un 500 en producción.
    assert.throws(() => requirePerm("PAGOS", "ver"), /accion inválida/);
  });
});

describe("bypass de administrador", () => {
  test("isAdmin 'S' pasa sin consultar la base", async () => {
    const r = await ejecutar(requirePerm("USUARIOS", "eliminar"), {
      id: "admin",
      isAdmin: "S",
    });
    assert.equal(r.status, 200);
    assert.equal(ultimaConsulta, null, "no debería consultar permisos");
  });

  test("isAdmin distinto de 'S' NO es bypass", async () => {
    // Ojo con los valores truthy: 'N', 'n', true o 1 no deben pasar.
    for (const valor of ["N", "n", "s", true, 1, "SI"]) {
      const r = await ejecutar(requirePerm("USUARIOS", "eliminar"), {
        id: "x",
        isAdmin: valor,
      });
      assert.equal(r.status, 403, `isAdmin=${JSON.stringify(valor)} no debe pasar`);
    }
  });
});

describe("requireAnyPerm", () => {
  test("alcanza con tener el flag en uno de los recursos", async () => {
    // Caso real: el cajero lee el catálogo por NUEVAVENTA, no por PRODUCTOS.
    permisos.add("NUEVAVENTA:puedeLeer");
    const r = await ejecutar(
      requireAnyPerm(["PRODUCTOS", "NUEVAVENTA"], "leer"),
      NO_ADMIN
    );
    assert.equal(r.status, 200);
  });

  test("sin ninguno de los recursos -> 403", async () => {
    permisos.add("CANCHA:puedeLeer");
    const r = await ejecutar(
      requireAnyPerm(["PRODUCTOS", "NUEVAVENTA"], "leer"),
      NO_ADMIN
    );
    assert.equal(r.status, 403);
  });

  test("pasa todos los recursos como parámetros (no los interpola en el SQL)", async () => {
    permisos.add("PRODUCTOS:puedeLeer");
    await ejecutar(
      requireAnyPerm(["PRODUCTOS", "NUEVAVENTA", "INVENTARIO"], "leer"),
      NO_ADMIN
    );
    assert.deepEqual(ultimaConsulta.params, [
      "cajero",
      "PRODUCTOS",
      "NUEVAVENTA",
      "INVENTARIO",
    ]);
    assert.ok(
      !ultimaConsulta.sql.includes("PRODUCTOS"),
      "los recursos no deben quedar embebidos en el texto del SQL"
    );
  });

  test("exige un array, no un string", () => {
    assert.throws(
      () => requireAnyPerm("PRODUCTOS", "leer"),
      /debe ser un array/
    );
  });

  test("exige al menos un recurso", () => {
    assert.throws(() => requireAnyPerm([], "leer"), /al menos un recurso/);
  });
});

describe("casos de borde", () => {
  test("sin usuario en el request -> 401, no 403", async () => {
    const r = await ejecutar(requirePerm("PAGOS", "leer"), undefined);
    assert.equal(r.status, 401);
  });

  test("usuario sin id -> 401", async () => {
    const r = await ejecutar(requirePerm("PAGOS", "leer"), { isAdmin: "N" });
    assert.equal(r.status, 401);
  });

  test("si la consulta de permisos falla -> 500 y NO pasa", async () => {
    // Ante una falla de base, negar. Un `next()` acá sería un bypass total.
    forzarError = new Error("conexión caída");
    const r = await ejecutar(requirePerm("PAGOS", "leer"), NO_ADMIN);
    assert.equal(r.status, 500);
  });

  test("el registro de recursos declarados incluye los usados", () => {
    requirePerm("RECURSO_DE_PRUEBA", "leer");
    assert.ok(
      requirePerm.recursosDeclarados.has("RECURSO_DE_PRUEBA"),
      "el chequeo de arranque necesita este registro para detectar typos"
    );
  });
});
