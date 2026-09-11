// Reporte de suscripciones vigentes por rango de fechas.
//
// Lo que protege este archivo es el SIGNIFICADO de "vigente", que es donde el
// reporte se puede equivocar sin que nadie lo note: el número sale, se ve
// razonable, y está mal. Los tres errores clásicos:
//
//   1. Contar por fecha de INICIO (como hace el reporte de ocupación mensual).
//      Eso responde "cuántos entraron", no "cuántos hay": el socio que arrancó
//      en marzo y sigue pagando en junio desaparece de junio.
//   2. Bordes exclusivos. Con planes mensuales encadenados, perder el día de
//      inicio o el de fin corre el conteo de todo el mes siguiente.
//   3. Confundir suscripciones con personas. Un socio con dos planes
//      solapados es una persona, no dos.
//
// Requiere base. Se saltea salvo que se corra con RUN_DB_TESTS=1:
//   RUN_DB_TESTS=1 node --test test/integration/
//
// Apuntar DB_NAME a una copia, no a la base de produccion del gimnasio.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const HABILITADO = process.env.RUN_DB_TESTS === "1";

// Rango fijo y lejano en el pasado a propósito: el solapamiento no depende de
// "hoy", así que fijar las fechas hace que los tests no cambien de resultado
// según el día en que se corran. Junio de 2019 tiene 30 días.
const DESDE = "2019-06-01";
const HASTA = "2019-06-30";
const DIAS_RANGO = 30;

describe(
  "reporte de suscripciones vigentes por rango",
  { skip: HABILITADO ? false : "definir RUN_DB_TESTS=1 para correr con base" },
  () => {
    let db, Suscripcion, ctrl;
    let planA = null;
    let planB = null;
    const clientes = [];

    const q = (sql, params) =>
      new Promise((res, rej) =>
        db.query(sql, params || [], (e, r) => (e ? rej(e) : res(r)))
      );

    async function nuevoCliente(nombre) {
      const r = await q(
        `INSERT INTO clientes (ClienteRUC, ClienteNombre, ClienteTipo)
         VALUES ('', ?, 'MI')`,
        [`TEST-VIG ${nombre}`]
      );
      clientes.push(r.insertId);
      return r.insertId;
    }

    const suscribir = (clienteId, inicio, fin, opciones = {}) =>
      q(
        `INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio,
            SuscripcionFechaFin, SuscripcionEstado, SuscripcionClasesRestantes)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [
          clienteId,
          opciones.planId || planA,
          inicio,
          fin,
          opciones.estado || "A",
        ]
      );

    /**
     * Corre el reporte acotado al plan de prueba. El filtro por plan es lo que
     * permite asertar sobre los TOTALES: sin él los agregados incluirían las
     * suscripciones reales de la base y no habría número estable que comparar.
     */
    const reporte = (opciones = {}) =>
      Suscripcion.getReporteVigentes({
        desde: DESDE,
        hasta: HASTA,
        paso: "dia",
        planId: planA,
        ...opciones,
      });

    const puntoDe = (serie, fecha) => serie.find((p) => p.fecha === fecha);

    /** Llama al endpoint sin levantar HTTP, con un `res` de mentira. */
    const llamarEndpoint = (query) =>
      new Promise((resolve) => {
        const res = {
          statusCode: 200,
          status(c) {
            this.statusCode = c;
            return this;
          },
          json(body) {
            resolve({ status: this.statusCode, body });
          },
        };
        ctrl.gimnasioSuscripcionesVigentes({ query }, res);
      });

    async function limpiar() {
      for (const c of clientes) {
        await q(
          `DELETE FROM pago WHERE SuscripcionId IN (
             SELECT SuscripcionId FROM suscripcion WHERE ClienteId = ?)`,
          [c]
        );
        await q("DELETE FROM suscripcion WHERE ClienteId = ?", [c]);
      }
    }

    before(async () => {
      db = require("../../config/db");
      Suscripcion = require("../../models/suscripcion.model");
      ctrl = require("../../controllers/reportes.controller");
      const a = await q(
        `INSERT INTO plan (PlanNombre, PlanDuracion, PlanPrecio, PlanActivo,
            PlanModalidad, PlanCantidadClases)
         VALUES ('TEST-VIG plan A', 30, 300000, 1, 'MENSUAL', 0)`
      );
      planA = a.insertId;
      const b = await q(
        `INSERT INTO plan (PlanNombre, PlanDuracion, PlanPrecio, PlanActivo,
            PlanModalidad, PlanCantidadClases)
         VALUES ('TEST-VIG plan B', 30, 500000, 1, 'MENSUAL', 0)`
      );
      planB = b.insertId;
    });

    after(async () => {
      if (!db) return;
      const intentar = async (sql, params) => {
        try {
          await q(sql, params);
        } catch (e) {
          console.error("limpieza:", e.message.slice(0, 80));
        }
      };
      try {
        for (const c of clientes) {
          await intentar(
            `DELETE FROM pago WHERE SuscripcionId IN (
               SELECT SuscripcionId FROM suscripcion WHERE ClienteId = ?)`,
            [c]
          );
          await intentar("DELETE FROM suscripcion WHERE ClienteId = ?", [c]);
          await intentar("DELETE FROM clientes WHERE ClienteId = ?", [c]);
        }
        for (const p of [planA, planB]) {
          if (p) await intentar("DELETE FROM plan WHERE PlanId = ?", [p]);
        }
      } finally {
        await db.end();
      }
    });

    beforeEach(limpiar);

    test("cuenta la suscripción que empezó ANTES del rango y sigue corriendo", async () => {
      // El caso que un reporte agrupado por fecha de inicio pierde entero.
      const c = await nuevoCliente("arranco-antes");
      await suscribir(c, "2019-05-01", "2019-07-31");

      const r = await reporte();
      assert.equal(r.resumen.suscripciones, 1);
      assert.equal(r.resumen.socios, 1);
      // No es un alta del período: arrancó antes.
      assert.equal(r.resumen.altas, 0);
      // Tampoco vence acá.
      assert.equal(r.resumen.bajas, 0);
      // Cubre el rango de punta a punta.
      assert.equal(r.resumen.completas, 1);

      const [d] = r.detalle;
      assert.equal(d.fechaInicio, "2019-05-01");
      assert.equal(d.fechaFin, "2019-07-31");
      // Aporta sólo los 30 días de junio, aunque dure 92.
      assert.equal(d.diasEnRango, DIAS_RANGO);
      assert.equal(d.diasTotales, 92);
    });

    test("la que termina a los pocos días del rango aparece y dice hasta cuándo cubre", async () => {
      // El caso que pidió el cliente, textual: suscripción del 5 de mayo al 5
      // de junio, consultando JUNIO ENTERO. Tiene que aparecer (arrancó antes,
      // pero estuvo vigente los primeros cinco días) y tiene que quedar claro
      // que su cobertura llega hasta el 5, sin obligar a nadie a cruzar
      // mentalmente la fecha de fin con el rango pedido.
      const c = await nuevoCliente("hasta-el-cinco");
      await suscribir(c, "2019-05-05", "2019-06-05");

      const r = await reporte();
      assert.equal(r.resumen.suscripciones, 1, "tiene que aparecer");

      const [d] = r.detalle;
      // La vigencia real se muestra completa: arranca en mayo.
      assert.equal(d.fechaInicio, "2019-05-05");
      assert.equal(d.fechaFin, "2019-06-05");
      // Y el tramo recortado al rango dice hasta cuándo cubrió en junio.
      assert.equal(d.cubreDesde, "2019-06-01");
      assert.equal(d.cubreHasta, "2019-06-05");
      assert.equal(d.diasEnRango, 5);
      assert.equal(d.diasTotales, 32);
      // Es una baja del período: su vigencia termina dentro del rango.
      assert.equal(r.resumen.bajas, 1);
      assert.equal(r.resumen.altas, 0, "arrancó antes, no es un alta de junio");
      // Estaba el primer día y ya no el 6.
      assert.equal(puntoDe(r.serie, "2019-06-05").suscripciones, 1);
      assert.equal(puntoDe(r.serie, "2019-06-06").suscripciones, 0);
    });

    test("la que cubre el rango entero se marca como tal, no recortada", async () => {
      const c = await nuevoCliente("cubre-todo");
      await suscribir(c, "2019-01-01", "2019-12-31");

      const [d] = (await reporte()).detalle;
      assert.equal(d.cubreDesde, DESDE);
      assert.equal(d.cubreHasta, HASTA);
      assert.equal(d.diasEnRango, DIAS_RANGO);
    });

    test("no cuenta las que quedan enteramente fuera del rango", async () => {
      const antes = await nuevoCliente("toda-antes");
      await suscribir(antes, "2019-04-01", "2019-05-31");
      const despues = await nuevoCliente("toda-despues");
      await suscribir(despues, "2019-07-01", "2019-07-31");

      const r = await reporte();
      assert.equal(r.resumen.suscripciones, 0);
      assert.equal(r.detalle.length, 0);
    });

    test("los dos bordes del rango son inclusivos", async () => {
      // Con planes mensuales encadenados, un borde exclusivo corre el conteo
      // de todo el mes siguiente y nadie lo nota hasta que no cierran las
      // cuentas.
      const ini = await nuevoCliente("termina-el-primer-dia");
      await suscribir(ini, "2019-05-01", DESDE);
      const fin = await nuevoCliente("empieza-el-ultimo-dia");
      await suscribir(fin, HASTA, "2019-07-30");

      const r = await reporte();
      assert.equal(r.resumen.suscripciones, 2);
      for (const d of r.detalle) {
        assert.equal(d.diasEnRango, 1, `${d.socio} debería aportar un solo día`);
      }
      assert.equal(puntoDe(r.serie, DESDE).suscripciones, 1);
      assert.equal(puntoDe(r.serie, HASTA).suscripciones, 1);
    });

    test("canceladas y suspendidas quedan afuera salvo que se pidan", async () => {
      const c1 = await nuevoCliente("cancelada");
      await suscribir(c1, "2019-06-05", "2019-06-25", { estado: "C" });
      const c2 = await nuevoCliente("suspendida");
      await suscribir(c2, "2019-06-05", "2019-06-25", { estado: "S" });

      const sinEllas = await reporte();
      assert.equal(sinEllas.resumen.suscripciones, 0);
      assert.equal(puntoDe(sinEllas.serie, "2019-06-10").suscripciones, 0);

      const conEllas = await reporte({ incluirCanceladas: true });
      assert.equal(conEllas.resumen.suscripciones, 2);
      assert.equal(puntoDe(conEllas.serie, "2019-06-10").suscripciones, 2);
      // El estado manual se respeta tal cual: no se recalcula por fechas.
      assert.deepEqual(
        conEllas.detalle.map((d) => d.estado).sort(),
        ["C", "S"]
      );
    });

    test("distingue suscripciones de socios cuando hay planes solapados", async () => {
      // Una persona con dos planes corriendo a la vez es UNA persona. Si el
      // reporte cuenta filas y lo llama "socios", infla el plantel.
      const c = await nuevoCliente("dos-planes");
      await suscribir(c, "2019-06-01", "2019-06-30");
      await suscribir(c, "2019-06-10", "2019-07-10");

      const r = await reporte();
      assert.equal(r.resumen.suscripciones, 2);
      assert.equal(r.resumen.socios, 1);
      // Y lo mismo dentro de la serie, en un día donde las dos corren.
      const dia = puntoDe(r.serie, "2019-06-15");
      assert.equal(dia.suscripciones, 2);
      assert.equal(dia.socios, 1);
    });

    test("la serie es un stock diario, con ceros en los días sin nadie", async () => {
      // Un hueco en el gráfico se lee como "no hay dato"; un cero se lee como
      // "no había nadie", que es lo que pasó. Tienen que ser ceros.
      const c = await nuevoCliente("tres-dias");
      await suscribir(c, "2019-06-10", "2019-06-12");

      const r = await reporte();
      assert.equal(r.serie.length, DIAS_RANGO);
      assert.equal(puntoDe(r.serie, "2019-06-09").suscripciones, 0);
      assert.equal(puntoDe(r.serie, "2019-06-10").suscripciones, 1);
      assert.equal(puntoDe(r.serie, "2019-06-12").suscripciones, 1);
      assert.equal(puntoDe(r.serie, "2019-06-13").suscripciones, 0);
      // El total del período NO es la suma de la serie: la misma suscripción
      // aparece en los tres días y sigue siendo una sola.
      assert.equal(r.resumen.suscripciones, 1);
    });

    test("altas y bajas se cuentan por la punta que cae dentro del rango", async () => {
      const alta = await nuevoCliente("alta-del-mes");
      await suscribir(alta, "2019-06-15", "2019-07-15");
      const baja = await nuevoCliente("vence-en-el-mes");
      await suscribir(baja, "2019-05-15", "2019-06-20");
      // Ojo con los nombres: `clientes.ClienteNombre` es varchar(30) y el
      // prefijo "TEST-VIG " ya se come 9.
      const pasante = await nuevoCliente("entra-y-sale");
      await suscribir(pasante, "2019-06-05", "2019-06-25");
      const atraviesa = await nuevoCliente("atraviesa-todo");
      await suscribir(atraviesa, "2019-01-01", "2019-12-31");

      const r = await reporte();
      assert.equal(r.resumen.suscripciones, 4);
      // Arrancan dentro: la del 15 y la del 5.
      assert.equal(r.resumen.altas, 2);
      // Terminan dentro: la del 20 y la del 25.
      assert.equal(r.resumen.bajas, 2);
      // Cubren el rango entero: sólo la anual.
      assert.equal(r.resumen.completas, 1);
    });

    test("vigentes al inicio y al fin son fotos de un día, no acumulados", async () => {
      const sale = await nuevoCliente("estaba-y-se-fue");
      await suscribir(sale, "2019-05-01", "2019-06-10");
      const entra = await nuevoCliente("entro-despues");
      await suscribir(entra, "2019-06-20", "2019-07-20");

      const r = await reporte();
      // En el período pasaron dos, pero nunca hubo dos a la vez.
      assert.equal(r.resumen.suscripciones, 2);
      assert.equal(r.resumen.vigentesAlInicio, 1);
      assert.equal(r.resumen.vigentesAlFin, 1);
      assert.equal(puntoDe(r.serie, "2019-06-15").suscripciones, 0);
    });

    test("el filtro por plan no mezcla planes", async () => {
      const a = await nuevoCliente("del-plan-a");
      await suscribir(a, "2019-06-01", "2019-06-30");
      const b = await nuevoCliente("del-plan-b");
      await suscribir(b, "2019-06-01", "2019-06-30", { planId: planB });

      const soloA = await reporte();
      assert.equal(soloA.resumen.suscripciones, 1);
      assert.equal(soloA.detalle[0].socio, "TEST-VIG del-plan-a");

      const soloB = await reporte({ planId: planB });
      assert.equal(soloB.resumen.suscripciones, 1);
      assert.equal(soloB.detalle[0].socio, "TEST-VIG del-plan-b");
    });

    test("el detalle avisa cuando quedó cortado, y los totales igual cuentan todo", async () => {
      // Mostrar una lista recortada sin decirlo es peor que no mostrarla: el
      // que la mira cree que ésas son todas.
      for (const n of [1, 2, 3]) {
        const c = await nuevoCliente(`recorte-${n}`);
        await suscribir(c, "2019-06-01", "2019-06-30");
      }

      const r = await reporte({ limiteDetalle: 2 });
      assert.equal(r.detalle.length, 2);
      assert.equal(r.detalleTruncado, true);
      assert.equal(r.resumen.suscripciones, 3, "el resumen cuenta las tres");

      const completo = await reporte({ limiteDetalle: 10 });
      assert.equal(completo.detalle.length, 3);
      assert.equal(completo.detalleTruncado, false);
    });

    test("el paso semanal devuelve menos puntos pero el mismo total", async () => {
      const c = await nuevoCliente("paso-semanal");
      await suscribir(c, "2019-05-01", "2019-07-31");

      const diario = await reporte();
      const semanal = await reporte({ paso: "semana" });
      assert.equal(diario.serie.length, DIAS_RANGO);
      assert.ok(
        semanal.serie.length < diario.serie.length,
        "el paso semanal tiene que achicar la serie"
      );
      assert.equal(semanal.resumen.suscripciones, diario.resumen.suscripciones);
      // Los extremos se calculan aparte de la serie justamente porque con paso
      // semanal el último punto generado puede caer antes de `hasta`.
      assert.equal(semanal.resumen.vigentesAlFin, 1);
    });

    test("el desglose por plan separa los planes y no pierde a nadie", async () => {
      const a1 = await nuevoCliente("plan-a-uno");
      await suscribir(a1, "2019-06-01", "2019-06-30");
      const a2 = await nuevoCliente("plan-a-dos");
      await suscribir(a2, "2019-06-05", "2019-06-25");
      const b1 = await nuevoCliente("plan-b-uno");
      await suscribir(b1, "2019-06-01", "2019-06-30", { planId: planB });

      // Sin filtro de plan el desglose tiene que traer los dos. Se corre sin
      // `planId` y se filtra en JS porque el reporte agrega sobre toda la base.
      const r = await Suscripcion.getReporteVigentes({
        desde: DESDE,
        hasta: HASTA,
        paso: "dia",
      });
      const mios = r.porPlan.filter((p) => [planA, planB].includes(p.planId));
      assert.equal(mios.length, 2);
      const a = mios.find((p) => p.planId === planA);
      const b = mios.find((p) => p.planId === planB);
      assert.equal(a.suscripciones, 2);
      assert.equal(a.socios, 2);
      assert.equal(a.plan, "TEST-VIG plan A");
      assert.equal(b.suscripciones, 1);
      // El id tiene que llegar: el adaptador de config/db renombra a
      // PascalCase las columnas reales, y con un alias en minúscula el campo
      // volvía undefined y el filtro por click del frontend no funcionaba.
      assert.equal(typeof b.planId, "number");
    });

    test("un socio con dos planes distintos cuenta en los dos", async () => {
      // Por eso la suma de socios del desglose puede superar el total: es una
      // propiedad del corte, no un error. Si alguna vez alguien "arregla" esto
      // sumando las filas, este test lo frena.
      const c = await nuevoCliente("dos-planes-dist");
      await suscribir(c, "2019-06-01", "2019-06-30");
      await suscribir(c, "2019-06-01", "2019-06-30", { planId: planB });

      const r = await Suscripcion.getReporteVigentes({ desde: DESDE, hasta: HASTA });
      const mios = r.porPlan.filter((p) => [planA, planB].includes(p.planId));
      assert.equal(mios.length, 2);
      assert.equal(
        mios.reduce((s, p) => s + p.socios, 0),
        2,
        "aparece una vez por plan"
      );
      // Pero como persona es una sola.
      const solo = await reporte();
      assert.equal(solo.resumen.socios, 1);
    });

    test("soloResumen saltea serie, detalle y desglose pero mantiene los totales", async () => {
      // Es lo que usa la comparación contra el período anterior: si trajera
      // las cinco consultas, comparar duplicaría el costo del reporte.
      const c = await nuevoCliente("solo-resumen");
      await suscribir(c, "2019-05-01", "2019-07-31");

      const completo = await reporte();
      const liviano = await reporte({ soloResumen: true });

      assert.deepEqual(liviano.serie, []);
      assert.deepEqual(liviano.detalle, []);
      assert.deepEqual(liviano.porPlan, []);
      // Los totales tienen que ser idénticos, incluidas las fotos de los
      // extremos: son justamente lo que la comparación va a mostrar.
      assert.equal(liviano.resumen.suscripciones, completo.resumen.suscripciones);
      assert.equal(liviano.resumen.socios, completo.resumen.socios);
      assert.equal(
        liviano.resumen.vigentesAlInicio,
        completo.resumen.vigentesAlInicio
      );
      assert.equal(liviano.resumen.vigentesAlFin, completo.resumen.vigentesAlFin);
    });

    test("la comparación mira el bloque contiguo anterior del mismo largo", async () => {
      // Junio son 30 días, así que el período anterior es del 2 al 31 de mayo
      // y NO mayo entero (31 días). Comparar bloques de distinto largo daría
      // una variación falsa, y con rangos libres "el mes pasado" no siempre
      // existe: igual largo es lo único que siempre vale.
      const viejo = await nuevoCliente("solo-en-mayo");
      await suscribir(viejo, "2019-05-10", "2019-05-20");
      const nuevo = await nuevoCliente("solo-en-junio");
      await suscribir(nuevo, "2019-06-10", "2019-06-20");
      // Este arranca el 1 de mayo: queda FUERA de la ventana de comparación,
      // que empieza el 2. Es el caso que delata un off-by-one en el corrimiento.
      const borde = await nuevoCliente("primero-de-mayo");
      await suscribir(borde, "2019-05-01", "2019-05-01");

      const r = await llamarEndpoint({
        fechaDesde: DESDE,
        fechaHasta: HASTA,
        planId: String(planA),
        comparar: "1",
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.comparacion.desde, "2019-05-02");
      assert.equal(r.body.comparacion.hasta, "2019-05-31");
      assert.equal(r.body.resumen.suscripciones, 1, "junio: sólo uno");
      assert.equal(
        r.body.comparacion.resumen.suscripciones,
        1,
        "mayo: el del 10 al 20; el del 1 de mayo queda fuera de la ventana"
      );
    });

    test("sin ?comparar la comparación es null, no ceros", async () => {
      // Un cero se lee como "el período anterior estuvo vacío". Null se lee
      // como "no se consultó", que es la verdad.
      const c = await nuevoCliente("sin-comparar");
      await suscribir(c, "2019-06-01", "2019-06-30");

      const r = await llamarEndpoint({
        fechaDesde: DESDE,
        fechaHasta: HASTA,
        planId: String(planA),
      });
      assert.equal(r.body.comparacion, null);
    });

    test("el saldo pendiente sale de los pagos imputados a la suscripción", async () => {
      const c = await nuevoCliente("pago-parcial");
      await suscribir(c, "2019-06-01", "2019-06-30");
      const [s] = await q(
        "SELECT SuscripcionId FROM suscripcion WHERE ClienteId = ?",
        [c]
      );
      await q(
        `INSERT INTO pago (SuscripcionId, PagoMonto, PagoTipo, PagoFecha,
            PagoUsuarioId)
         VALUES (?, 100000, 'CO', '2019-06-02', 'TEST-VIG')`,
        [s.SuscripcionId]
      );

      const r = await reporte();
      const [d] = r.detalle;
      // El plan A vale 300.000 y se pagaron 100.000.
      assert.equal(d.totalPagado, 100000);
      assert.equal(d.saldoPendiente, 200000);
      assert.equal(d.estadoPago, "PENDIENTE");
    });
  }
);
