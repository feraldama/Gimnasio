// Descuento de cupo de clases al registrar asistencia. Es la regla con plata
// de por medio: si el cupo no se descuenta, el socio entra gratis; si se
// descuenta sin registrar la entrada, pierde una clase pagada.
//
// El caso central es la atomicidad. El comentario de `registrar` explica que
// antes un fallo del UPDATE tras un INSERT exitoso dejaba la entrada
// registrada sin descontar, y que sin chequear affectedRows una carrera podía
// registrar el ingreso con el cupo ya en 0 (TOCTOU). Estos tests verifican que
// cuando el cupo está agotado NO queda ninguna asistencia registrada.
//
// Requiere base. Se saltea salvo que se corra con RUN_DB_TESTS=1:
//   RUN_DB_TESTS=1 node --test test/integration/
//
// Apuntar DB_NAME a una copia, no a la base de producción del gimnasio.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const HABILITADO = process.env.RUN_DB_TESTS === "1";

describe(
  "asistencia: descuento de cupo de clases",
  { skip: HABILITADO ? false : "definir RUN_DB_TESTS=1 para correr con base" },
  () => {
    let db, Asistencia;
    // Ids de las filas que crea el test. La limpieza borra por ClienteId y
    // PlanId, no por id de suscripción: cada caso crea la suya y guardar sólo
    // la última dejaba filas huérfanas (lo detectó este mismo test, con un
    // error de llave foránea al intentar borrar el plan).
    const creado = { clienteId: null, planId: null };

    const q = (sql, params) =>
      new Promise((res, rej) =>
        db.query(sql, params || [], (e, r) => (e ? rej(e) : res(r)))
      );

    before(async () => {
      db = require("../../config/db");
      Asistencia = require("../../models/asistencia.model");

      const cli = await q(
        `INSERT INTO clientes (ClienteRUC, ClienteNombre, ClienteApellido, ClienteTipo)
         VALUES ('', 'TEST-CUPO', 'AUTOMATIZADO', 'MI')`
      );
      creado.clienteId = cli.insertId;

      const plan = await q(
        `INSERT INTO plan (PlanNombre, PlanDuracion, PlanPrecio, PlanPermiteClases,
                           PlanActivo, PlanModalidad, PlanCantidadClases)
         VALUES ('TEST-CUPO 8 clases', 30, 0, 1, 1, 'CLASES', 8)`
      );
      creado.planId = plan.insertId;
    });

    after(async () => {
      if (!db) return;
      try {
        // Orden inverso a la creación, respetando las llaves foráneas.
        if (creado.clienteId) {
          await q("DELETE FROM asistencia WHERE ClienteId = ?", [
            creado.clienteId,
          ]);
          await q("DELETE FROM suscripcion WHERE ClienteId = ?", [
            creado.clienteId,
          ]);
        }
        if (creado.planId) {
          await q("DELETE FROM plan WHERE PlanId = ?", [creado.planId]);
        }
        if (creado.clienteId) {
          await q("DELETE FROM clientes WHERE ClienteId = ?", [
            creado.clienteId,
          ]);
        }
      } finally {
        // Cerrar el pool siempre, incluso si la limpieza falló: si no, el
        // proceso queda vivo hasta que expire idleTimeoutMillis (60 s).
        await db.end();
      }
    });

    // Crea una suscripción CLASES con el cupo indicado y devuelve el objeto
    // con la forma que `registrar` espera recibir de `estadoAcceso`.
    async function nuevaSuscripcion(cupo) {
      const r = await q(
        `INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio,
                                  SuscripcionFechaFin, SuscripcionEstado,
                                  SuscripcionClasesRestantes)
         VALUES (?, ?, CURRENT_DATE - 1, CURRENT_DATE + 30, 'A', ?)`,
        [creado.clienteId, creado.planId, cupo]
      );
      return {
        SuscripcionId: r.insertId,
        PlanModalidad: "CLASES",
        SuscripcionClasesRestantes: cupo,
      };
    }

    const cupoActual = async (id) =>
      Number(
        (
          await q(
            "SELECT SuscripcionClasesRestantes AS n FROM suscripcion WHERE SuscripcionId = ?",
            [id]
          )
        )[0].n
      );

    const asistenciasDelCliente = async () =>
      Number(
        (
          await q("SELECT COUNT(*) AS n FROM asistencia WHERE ClienteId = ?", [
            creado.clienteId,
          ])
        )[0].n
      );

    test("descuenta exactamente una clase por entrada", async () => {
      const sus = await nuevaSuscripcion(3);
      const r = await Asistencia.registrar(creado.clienteId, sus);
      assert.equal(r.clasesRestantes, 2, "debe devolver el cupo real, no asumir");
      assert.equal(await cupoActual(sus.SuscripcionId), 2);
      assert.ok(r.asistencia, "debe devolver la asistencia registrada");
    });

    test("descuentos sucesivos llegan hasta cero", async () => {
      const sus = await nuevaSuscripcion(3);
      const antes = await asistenciasDelCliente();
      for (const esperado of [2, 1, 0]) {
        const r = await Asistencia.registrar(creado.clienteId, sus);
        assert.equal(r.clasesRestantes, esperado);
      }
      assert.equal(await cupoActual(sus.SuscripcionId), 0);
      assert.equal(
        await asistenciasDelCliente(),
        antes + 3,
        "tres entradas, tres asistencias"
      );
    });

    test("con cupo en cero lanza SIN_CUPO", async () => {
      const sus = await nuevaSuscripcion(0);
      await assert.rejects(
        () => Asistencia.registrar(creado.clienteId, sus),
        (e) => e.code === "SIN_CUPO"
      );
    });

    test("cupo agotado: NO queda la asistencia registrada (rollback)", async () => {
      // Es el corazón del arreglo de TOCTOU: el INSERT ocurre antes del
      // UPDATE, así que sin rollback la entrada quedaría grabada igual y el
      // socio habría entrado sin gastar clase.
      const sus = await nuevaSuscripcion(0);
      const antes = await asistenciasDelCliente();
      await assert.rejects(() => Asistencia.registrar(creado.clienteId, sus));
      assert.equal(
        await asistenciasDelCliente(),
        antes,
        "el rollback tiene que haber descartado el INSERT de asistencia"
      );
    });

    test("el cupo nunca queda negativo", async () => {
      const sus = await nuevaSuscripcion(1);
      await Asistencia.registrar(creado.clienteId, sus);
      await assert.rejects(() => Asistencia.registrar(creado.clienteId, sus));
      const cupo = await cupoActual(sus.SuscripcionId);
      assert.equal(cupo, 0);
      assert.ok(cupo >= 0, "el cupo no puede ser negativo");
    });

    test("un plan MENSUAL registra la entrada sin tocar cupo", async () => {
      const sus = await nuevaSuscripcion(5);
      const r = await Asistencia.registrar(creado.clienteId, {
        ...sus,
        PlanModalidad: "MENSUAL",
      });
      assert.equal(r.clasesRestantes, null, "MENSUAL no reporta cupo");
      assert.equal(
        await cupoActual(sus.SuscripcionId),
        5,
        "no debe descontar en modalidad MENSUAL"
      );
      assert.ok(r.asistencia);
    });

    test("sin suscripción registra la entrada y no falla", async () => {
      // El kiosko ya validó el acceso; acá sólo importa que no reviente.
      const r = await Asistencia.registrar(creado.clienteId, null);
      assert.ok(r.asistencia);
      assert.equal(r.clasesRestantes, null);
    });
  }
);
