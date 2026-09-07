// Utilidades chicas pero con consecuencias: escape de LIKE (búsquedas),
// sigla del día de semana (tarifas de cancha por banda) y los métodos de pago
// que mueven el cajón físico.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

// `canchaTarifa.model` arrastra `config/db`, que al cargarse abre el pool de
// Postgres y mantiene el proceso vivo 60 s (idleTimeoutMillis). Como acá sólo
// se usa `siglaDia`, que es pura, inyectamos un doble del módulo de base.
const rutaDb = require.resolve("../config/db");
require.cache[rutaDb] = {
  id: rutaDb,
  filename: rutaDb,
  loaded: true,
  exports: { query: () => { throw new Error("test unitario: no debe consultar la base"); } },
};

const { escapeLike } = require("../utils/sql");
const { siglaDia } = require("../models/canchaTarifa.model");
const { PAGO_TIPOS, METODOS_EFECTIVO } = require("../constants/pagoTipos");
const {
  mensajeConflictoUnico,
  sendError,
  isSafeMessage,
} = require("../utils/errors");
const { validarEnv } = require("../config/env");

// La barra invertida se construye con fromCharCode para que el test no
// dependa de cuantos niveles de escape sobreviven al editor o al shell.
const B = String.fromCharCode(92);

describe("escapeLike", () => {
  test("escapa el comodín %", () => {
    // Buscar "50%" no debe traer todo lo que empieza con 50.
    assert.equal(escapeLike("50%"), "50" + B + "%");
  });

  test("escapa el comodín _", () => {
    assert.equal(escapeLike("a_b"), "a" + B + "_b");
  });

  test("escapa la barra invertida", () => {
    assert.equal(escapeLike(B), B + B);
    assert.equal(escapeLike("a" + B + "b"), "a" + B + B + "b");
  });

  test("deja el texto normal intacto", () => {
    assert.equal(escapeLike("Coca Cola 500ml"), "Coca Cola 500ml");
  });

  test("null y undefined devuelven cadena vacía", () => {
    assert.equal(escapeLike(null), "");
    assert.equal(escapeLike(undefined), "");
  });

  test("convierte números a string", () => {
    assert.equal(escapeLike(123), "123");
  });
});

describe("siglaDia", () => {
  // Las bandas de tarifa se guardan como CSV de letras L,M,X,J,V,S,D y se
  // consultan con LIKE '%<letra>%'. Si la letra sale mal, se cobra la tarifa
  // de otro día.
  const CASOS = [
    [new Date(2026, 8, 7), "L", "lunes"],
    [new Date(2026, 8, 8), "M", "martes"],
    [new Date(2026, 8, 9), "X", "miércoles"],
    [new Date(2026, 8, 10), "J", "jueves"],
    [new Date(2026, 8, 11), "V", "viernes"],
    [new Date(2026, 8, 12), "S", "sábado"],
    [new Date(2026, 8, 13), "D", "domingo"],
  ];
  for (const [fecha, sigla, nombre] of CASOS) {
    test(`${nombre} -> ${sigla}`, () => {
      assert.equal(siglaDia(fecha), sigla);
    });
  }

  test("miércoles usa X y no M (no colisiona con martes)", () => {
    // Con LIKE '%M%', si el miércoles fuera "MI" matchearía también martes.
    assert.notEqual(siglaDia(new Date(2026, 8, 9)), "M");
  });

  test("las siete siglas son distintas entre sí", () => {
    const todas = CASOS.map(([f]) => siglaDia(f));
    assert.equal(new Set(todas).size, 7);
  });
});

describe("métodos de pago que mueven el cajón", () => {
  test("sólo el contado suma a Caja.CajaMonto", () => {
    // POS, voucher, transferencia y crédito quedan en planilla pero no
    // ingresan efectivo al cajón. Si esto cambiara, el cierre de caja no
    // cuadraría con el dinero físico.
    assert.ok(METODOS_EFECTIVO.has("CO"));
    for (const codigo of ["CR", "PO", "VO", "TR"]) {
      assert.ok(
        !METODOS_EFECTIVO.has(codigo),
        `${codigo} no debería mover el cajón`
      );
    }
  });

  test("todo método en METODOS_EFECTIVO existe en PAGO_TIPOS", () => {
    for (const codigo of METODOS_EFECTIVO) {
      assert.ok(PAGO_TIPOS[codigo], `${codigo} no está en PAGO_TIPOS`);
    }
  });

  test("cada tipo de pago tiene código, etiqueta y grupo de gasto", () => {
    for (const [clave, tipo] of Object.entries(PAGO_TIPOS)) {
      assert.equal(tipo.codigo, clave, "el código debe coincidir con la clave");
      assert.ok(tipo.label, `${clave} sin label`);
      assert.equal(
        typeof tipo.tipoGastoGrupoId,
        "number",
        `${clave} sin tipoGastoGrupoId numérico`
      );
    }
  });
});

describe("mensajeConflictoUnico", () => {
  test("traduce la CI duplicada a un mensaje para el mostrador", () => {
    const msg = mensajeConflictoUnico({
      code: "23505",
      constraint: "uq_clientes_ruc_no_vacio",
    });
    assert.match(msg, /cédula/i);
  });

  test("una restricción desconocida cae en un mensaje genérico", () => {
    assert.match(
      mensajeConflictoUnico({ code: "23505", constraint: "otra" }),
      /Ya existe/
    );
  });

  test("otros errores devuelven null (siguen siendo 500)", () => {
    assert.equal(mensajeConflictoUnico({ code: "23503" }), null);
    assert.equal(mensajeConflictoUnico(new Error("x")), null);
    assert.equal(mensajeConflictoUnico(null), null);
  });
});

describe("validarEnv", () => {
  const log = { warn() {}, error() {}, log() {} };

  test("sin JWT_SECRET reporta error (y en el arranque real corta)", () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      const r = validarEnv({ exitOnError: false, log });
      assert.equal(r.errores.length, 1);
      assert.match(r.errores[0], /JWT_SECRET/);
    } finally {
      process.env.JWT_SECRET = original;
    }
  });

  test("un JWT_SECRET corto avisa pero no bloquea", () => {
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "corta";
    try {
      const r = validarEnv({ exitOnError: false, log });
      assert.equal(r.errores.length, 0);
      assert.equal(r.avisos.length, 1);
    } finally {
      process.env.JWT_SECRET = original;
    }
  });

  test("un JWT_SECRET largo pasa sin errores ni avisos", () => {
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "x".repeat(48);
    try {
      const r = validarEnv({ exitOnError: false, log });
      assert.deepEqual(r, { errores: [], avisos: [] });
    } finally {
      process.env.JWT_SECRET = original;
    }
  });
});

describe("sendError", () => {
  // Es el camino de error estándar de la API: decide qué mensaje ve el cliente
  // y qué queda sólo en el log. Un fallo acá filtra el esquema de la base o
  // esconde un mensaje que el operador necesita leer.
  const capturar = (err, status, fallback) => {
    let salida = null;
    const res = {
      status: (c) => ({ json: (b) => (salida = { status: c, body: b }) }),
    };
    const logOriginal = console.error;
    console.error = () => {};
    try {
      sendError(res, err, status, fallback);
    } finally {
      console.error = logOriginal;
    }
    return salida;
  };

  test("un error del driver de Postgres NO llega al cliente", () => {
    // Este es el mensaje real que devolvía la API antes del barrido.
    const err = Object.assign(
      new Error("la sintaxis de entrada no es válida para tipo integer: «abc»"),
      { code: "22P02" }
    );
    const r = capturar(err, 500);
    assert.equal(r.status, 500);
    assert.equal(r.body.message, "Error interno");
  });

  test("una violación de llave foránea no expone el nombre de la tabla", () => {
    const err = Object.assign(
      new Error('viola la llave foránea «ipago1» en la tabla «pago»'),
      { code: "23503", constraint: "ipago1", table: "pago" }
    );
    const r = capturar(err, 500);
    assert.ok(
      !/pago|ipago1/.test(r.body.message),
      `el mensaje no debe nombrar tablas ni restricciones: ${r.body.message}`
    );
  });

  test("un mensaje de negocio del modelo SÍ llega al cliente", () => {
    // Los modelos rechazan con objetos planos a propósito, para mostrarle algo
    // útil al operador.
    const r = capturar({ message: "El plan no admite clases" }, 400);
    assert.equal(r.status, 400);
    assert.equal(r.body.message, "El plan no admite clases");
  });

  test("respeta el fallback que le pasa el controlador", () => {
    const err = Object.assign(new Error("detalle interno"), { code: "42P01" });
    const r = capturar(err, 500, "Error al crear cliente");
    assert.equal(r.body.message, "Error al crear cliente");
  });

  test("un Error nativo sin código tampoco se filtra", () => {
    // Un TypeError o un throw suelto puede traer rutas de archivo en el texto.
    const r = capturar(new Error("Cannot read properties of undefined"), 500);
    assert.equal(r.body.message, "Error interno");
  });

  test("isSafeMessage: un error con .code se considera NO seguro", () => {
    // Es el motivo por el que el caso SIN_CUPO de asistencia se responde a
    // mano: el modelo lo marca con `.code`, así que sendError lo ocultaría.
    const sinCupo = Object.assign(new Error("Cupo de clases agotado"), {
      code: "SIN_CUPO",
    });
    assert.equal(isSafeMessage(sinCupo), false);
  });
});
