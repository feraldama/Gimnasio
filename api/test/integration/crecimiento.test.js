// Crecimiento de socios contra la base: altas, renovaciones, bajas y
// retención. Es un reporte de definiciones, así que los tests son escenarios
// de socios reales — el valor está en fijar qué cuenta como qué.
//
// Requiere base. Se saltea salvo que se corra con RUN_DB_TESTS=1:
//   RUN_DB_TESTS=1 node --test test/integration/
//
// Apuntar DB_NAME a una copia, no a la base de producción del gimnasio.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const HABILITADO = process.env.RUN_DB_TESTS === "1";

// Año en el futuro para no cruzarse con datos reales.
const ANIO = 2098;

describe(
  "crecimiento de socios",
  { skip: HABILITADO ? false : "definir RUN_DB_TESTS=1 para correr con base" },
  () => {
    let db, ctrl;
    let planId = null;
    const clientes = [];

    const q = (sql, params) =>
      new Promise((res, rej) =>
        db.query(sql, params || [], (e, r) => (e ? rej(e) : res(r)))
      );

    const pedir = (mes, anio = ANIO) =>
      new Promise((resolve, reject) => {
        const req = { query: { anio: String(anio), mes: String(mes) } };
        const res = {
          json: resolve,
          status: (code) => ({
            json: (body) =>
              reject(new Error(`respondió ${code}: ${JSON.stringify(body)}`)),
          }),
        };
        ctrl.crecimientoSocios(req, res).catch(reject);
      });

    /** Crea un cliente de prueba y devuelve su id. */
    async function nuevoCliente(nombre) {
      const r = await q(
        `INSERT INTO clientes (ClienteRUC, ClienteNombre, ClienteTipo)
         VALUES ('', ?, 'MI')`,
        [`TEST-CREC ${nombre}`]
      );
      clientes.push(r.insertId);
      return r.insertId;
    }

    /** Suscripción de un cliente entre dos fechas. */
    const suscribir = (clienteId, inicio, fin, estado = "A") =>
      q(
        `INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio,
            SuscripcionFechaFin, SuscripcionEstado, SuscripcionClasesRestantes)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [clienteId, planId, inicio, fin, estado]
      );

    const limpiarSuscripciones = async () => {
      if (!clientes.length) return;
      for (const c of clientes) {
        await q("DELETE FROM suscripcion WHERE ClienteId = ?", [c]);
      }
    };

    before(async () => {
      db = require("../../config/db");
      ctrl = require("../../controllers/tablero.controller");
      const plan = await q(
        `INSERT INTO plan (PlanNombre, PlanDuracion, PlanPrecio, PlanActivo, PlanModalidad)
         VALUES ('TEST-CREC', 30, 0, 1, 'MENSUAL')`
      );
      planId = plan.insertId;
    });

    after(async () => {
      if (!db) return;
      try {
        await limpiarSuscripciones();
        for (const c of clientes) {
          await q("DELETE FROM clientes WHERE ClienteId = ?", [c]);
        }
        if (planId) await q("DELETE FROM plan WHERE PlanId = ?", [planId]);
      } finally {
        await db.end();
      }
    });

    // Cada escenario arranca sin suscripciones para que los conteos sean
    // exactos y no dependan del test anterior.
    beforeEach(limpiarSuscripciones);

    test("la primera suscripción de un cliente es un ALTA", async () => {
      const c = await nuevoCliente("alta");
      await suscribir(c, `${ANIO}-03-01`, `${ANIO}-03-31`);
      const r = await pedir(3);
      assert.equal(r.altas.cantidad, 1);
      assert.equal(r.renovaciones.cantidad, 0);
    });

    test("la segunda suscripción del mismo cliente es RENOVACIÓN", async () => {
      const c = await nuevoCliente("renov");
      await suscribir(c, `${ANIO}-03-01`, `${ANIO}-03-31`);
      await suscribir(c, `${ANIO}-04-01`, `${ANIO}-04-30`);
      const marzo = await pedir(3);
      const abril = await pedir(4);
      assert.equal(marzo.altas.cantidad, 1, "marzo: socio nuevo");
      assert.equal(abril.altas.cantidad, 0, "abril: no es socio nuevo");
      assert.equal(abril.renovaciones.cantidad, 1);
    });

    test("altas y renovaciones no se solapan ni dejan huecos", async () => {
      // Propiedad: toda suscripción que arranca en el mes es exactamente una
      // de las dos. Si se solaparan, el total inflaría.
      const a = await nuevoCliente("mix-a");
      const b = await nuevoCliente("mix-b");
      await suscribir(a, `${ANIO}-05-01`, `${ANIO}-05-31`); // alta
      await suscribir(b, `${ANIO}-04-01`, `${ANIO}-04-30`); // alta (abril)
      await suscribir(b, `${ANIO}-05-05`, `${ANIO}-06-04`); // renovación
      const r = await pedir(5);
      assert.equal(r.altas.cantidad, 1);
      assert.equal(r.renovaciones.cantidad, 1);
      const total = await q(
        `SELECT COUNT(*)::int AS n FROM suscripcion
          WHERE EXTRACT(YEAR FROM SuscripcionFechaInicio)::int = ?
            AND EXTRACT(MONTH FROM SuscripcionFechaInicio)::int = 5`,
        [ANIO]
      );
      assert.equal(
        r.altas.cantidad + r.renovaciones.cantidad,
        total[0].n,
        "altas + renovaciones debe dar el total de suscripciones del mes"
      );
    });

    test("renovar DENTRO de la gracia cuenta como retenido, no como baja", async () => {
      // Vence el 31 de marzo y vuelve el 10 de abril: 10 días, dentro de los
      // 15 de gracia. Sin la ventana, esto sería una baja de marzo.
      const c = await nuevoCliente("gracia-dentro");
      await suscribir(c, `${ANIO}-03-01`, `${ANIO}-03-31`);
      await suscribir(c, `${ANIO}-04-10`, `${ANIO}-05-09`);
      const r = await pedir(3);
      assert.equal(r.retencion.vencidas, 1);
      assert.equal(r.retencion.retenidas, 1);
      assert.equal(r.bajas.cantidad, 0);
      assert.equal(r.retencion.tasaPct, 100);
    });

    test("volver DESPUÉS de la gracia rompe la retención del mes", async () => {
      // Vence el 31 de marzo y vuelve el 30 de abril: 30 días, fuera de los
      // 15 de gracia. La interrupción se ve en la RETENCIÓN de marzo.
      //
      // En cambio no es baja de marzo: la baja marca el mes en que se termina
      // la última cobertura de la persona, y este socio volvió. Son dos
      // preguntas distintas y el reporte responde las dos.
      const c = await nuevoCliente("gracia-fuera");
      await suscribir(c, `${ANIO}-03-01`, `${ANIO}-03-31`);
      await suscribir(c, `${ANIO}-04-30`, `${ANIO}-05-29`);
      const marzo = await pedir(3);
      assert.equal(marzo.retencion.vencidas, 1);
      assert.equal(marzo.retencion.retenidas, 0, "no renovó en la ventana");
      assert.equal(marzo.retencion.tasaPct, 0);
      assert.equal(marzo.bajas.cantidad, 0, "pero no se fue del gimnasio");
      const mayo = await pedir(5);
      assert.equal(mayo.bajas.cantidad, 1, "la baja cae cuando termina de verdad");
    });

    test("el que vence y no vuelve nunca es baja", async () => {
      const c = await nuevoCliente("se-fue");
      await suscribir(c, `${ANIO}-03-01`, `${ANIO}-03-31`);
      const r = await pedir(3);
      assert.equal(r.bajas.cantidad, 1);
    });

    test("un socio nuevo con dos planes el mismo día es UN socio nuevo", async () => {
      // Contando suscripciones eran dos altas y, al vencer, dos bajas: una
      // sola persona generaba rotación fantasma.
      const c = await nuevoCliente("dos-el-mismo-dia");
      await suscribir(c, `${ANIO}-03-05`, `${ANIO}-04-04`);
      await suscribir(c, `${ANIO}-03-05`, `${ANIO}-04-04`);
      const r = await pedir(3);
      assert.equal(r.altas.cantidad, 1, "es una persona");
      assert.equal(r.renovaciones.cantidad, 1, "la segunda es un evento aparte");
      assert.equal(r.bajas.cantidad, 0, "todavía no vence nada en marzo");
    });

    test("con planes solapados no hay baja mientras siga habiendo cobertura", async () => {
      // Un plan que vence en abril y otro corriendo hasta junio: el socio no
      // se fue. Antes el mismo response lo mostraba como activo Y como baja.
      const c = await nuevoCliente("solapado");
      await suscribir(c, `${ANIO}-03-01`, `${ANIO}-04-15`);
      await suscribir(c, `${ANIO}-04-01`, `${ANIO}-06-30`);
      const abril = await pedir(4);
      assert.equal(abril.bajas.cantidad, 0, "sigue teniendo cobertura");
      assert.equal(abril.activosFinDeMes, 1);
      const junio = await pedir(6);
      assert.equal(junio.bajas.cantidad, 1, "la baja recae en el mes real");
    });

    test("una cancelación se informa pero no entra en las bajas", async () => {
      // 'C' no distingue "el socio se fue" de "el alta se cargó mal y se
      // anuló", así que sumarla al neto inventaría rotación. Se muestra como
      // dato aparte.
      const c = await nuevoCliente("cancelado-viejo");
      await suscribir(c, `${ANIO}-02-10`, `${ANIO}-03-20`, "C");
      const r = await pedir(3);
      assert.equal(r.retencion.canceladas, 1, "se informa");
      assert.equal(r.bajas.cantidad, 0, "pero no cuenta como baja");
      assert.equal(r.retencion.vencidas, 0, "ni entra en el universo de retención");
    });

    test("alta y cancelación en el mismo mes no mueven ninguna cifra", async () => {
      // El alta cargada por error y anulada enseguida no debe aparecer ni
      // como socio nuevo ni como baja.
      const c = await nuevoCliente("cancelado-mismo-mes");
      await suscribir(c, `${ANIO}-03-01`, `${ANIO}-03-31`, "C");
      const r = await pedir(3);
      assert.equal(r.altas.cantidad, 0, "no es un alta");
      assert.equal(r.bajas.cantidad, 0, "ni una baja");
    });

    test("una suscripción cancelada no cuenta como alta ni como renovación", async () => {
      const c = await nuevoCliente("cancel-no-alta");
      await suscribir(c, `${ANIO}-03-05`, `${ANIO}-04-04`, "C");
      const otro = await nuevoCliente("cancel-no-renov");
      await suscribir(otro, `${ANIO}-02-01`, `${ANIO}-02-28`);
      await suscribir(otro, `${ANIO}-03-05`, `${ANIO}-04-04`, "C");
      const r = await pedir(3);
      assert.equal(r.altas.cantidad, 0);
      assert.equal(r.renovaciones.cantidad, 0);
    });

    test("la tasa de retención es null si no venció ninguna", async () => {
      const c = await nuevoCliente("sin-vencer");
      await suscribir(c, `${ANIO}-03-01`, `${ANIO}-12-31`);
      const r = await pedir(3);
      assert.equal(r.retencion.vencidas, 0);
      assert.equal(r.retencion.tasaPct, null, "no existe retener el 0% de nada");
    });

    test("el neto negativo muestra que el gimnasio se vacía", async () => {
      // Tres bajas y un alta en el mismo mes.
      const nuevos = [];
      for (const n of ["v1", "v2", "v3"]) {
        const c = await nuevoCliente(n);
        nuevos.push(c);
        await suscribir(c, `${ANIO}-02-01`, `${ANIO}-03-15`);
      }
      const alta = await nuevoCliente("nuevo-marzo");
      await suscribir(alta, `${ANIO}-03-20`, `${ANIO}-04-19`);
      const r = await pedir(3);
      assert.equal(r.altas.cantidad, 1);
      assert.equal(r.bajas.cantidad, 3);
      // El crecimiento sale del stock de activos: al cierre de marzo sólo
      // queda el socio nuevo, contra tres al cierre de febrero.
      assert.equal(r.variacionActivos.activosFinDeMes, 1);
      assert.equal(r.variacionActivos.activosFinMesAnterior, 3);
      assert.equal(r.variacionActivos.cantidad, -2);
    });

    test("socios activos al cierre cuenta clientes distintos, no suscripciones", async () => {
      // Un socio con dos planes solapados es UNA persona en el gimnasio.
      const c = await nuevoCliente("dos-planes");
      await suscribir(c, `${ANIO}-03-01`, `${ANIO}-04-30`);
      await suscribir(c, `${ANIO}-03-05`, `${ANIO}-04-30`);
      const r = await pedir(3);
      assert.equal(r.activosFinDeMes, 1);
      assert.equal(
        r.renovaciones.cantidad,
        1,
        "pero como suscripción, la segunda sí es una renovación"
      );
    });

    test("no cuenta como activo al cierre quien vencio antes de fin de mes", async () => {
      const c = await nuevoCliente("vencio-antes");
      await suscribir(c, `${ANIO}-03-01`, `${ANIO}-03-20`);
      const r = await pedir(3);
      assert.equal(r.activosFinDeMes, 0);
    });

    test("compara contra el mes anterior", async () => {
      const a = await nuevoCliente("comp-a");
      const b = await nuevoCliente("comp-b");
      const c = await nuevoCliente("comp-c");
      await suscribir(a, `${ANIO}-02-01`, `${ANIO}-02-28`); // alta feb
      await suscribir(b, `${ANIO}-03-01`, `${ANIO}-03-31`); // alta mar
      await suscribir(c, `${ANIO}-03-02`, `${ANIO}-04-01`); // alta mar
      const r = await pedir(3);
      assert.equal(r.altas.cantidad, 2);
      assert.equal(r.altas.mesAnterior, 1);
      assert.equal(r.altas.variacionPct, 100);
      assert.deepEqual(r.mesAnteriorRef, { anio: ANIO, mes: 2 });
    });

    test("un mes vencido hace mucho no queda marcado como provisorio", async () => {
      // La ventana de gracia de un mes de 2098 aún no pasó, pero uno de 2020
      // sí: ese debe cerrar como definitivo.
      const c = await nuevoCliente("viejo");
      await suscribir(c, "2020-03-01", "2020-03-31");
      const r = await pedir(3, 2020);
      assert.equal(r.provisorio, false);
      assert.equal(r.bajas.cantidad, 1);
    });

    test("informa los días de gracia usados", async () => {
      const r = await pedir(3);
      assert.equal(typeof r.diasGracia, "number");
      assert.ok(r.diasGracia > 0);
    });

    test("rechaza parámetros inválidos", async () => {
      await assert.rejects(() => pedir(13), /400/);
      await assert.rejects(() => pedir(5, 1800), /400/);
    });
  }
);
