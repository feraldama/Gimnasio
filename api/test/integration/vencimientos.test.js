// Lista de trabajo de vencimientos: a quién hay que llamar para que renueve.
//
// En un gimnasio el cobro y la retención son lo mismo, porque el acceso es
// prepago: el kiosko bloquea la entrada cuando la suscripción no está
// vigente. Así que esta lista es la herramienta de cobranza real.
//
// Los escenarios de acá se escribieron ANTES de la consulta, porque las
// últimas rondas mostraron que en este dominio los casos raros (socio con
// planes solapados, socio que ya renovó) son los que rompen el reporte.
//
// Requiere base. Se saltea salvo que se corra con RUN_DB_TESTS=1:
//   RUN_DB_TESTS=1 node --test test/integration/
//
// Apuntar DB_NAME a una copia, no a la base de producción del gimnasio.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const HABILITADO = process.env.RUN_DB_TESTS === "1";

describe(
  "lista de vencimientos",
  { skip: HABILITADO ? false : "definir RUN_DB_TESTS=1 para correr con base" },
  () => {
    let db, Suscripcion, dateUtils;
    let planMensual = null;
    let planClases = null;
    const clientes = [];

    const q = (sql, params) =>
      new Promise((res, rej) =>
        db.query(sql, params || [], (e, r) => (e ? rej(e) : res(r)))
      );

    // Fechas relativas a hoy: la consulta usa la fecha local del servidor.
    const enDias = (n) => dateUtils.addDaysLocal(dateUtils.todayLocalISO(), n);

    async function nuevoCliente(nombre, telefono = "0981000000") {
      const r = await q(
        `INSERT INTO clientes (ClienteRUC, ClienteNombre, ClienteTelefono, ClienteTipo)
         VALUES ('', ?, ?, 'MI')`,
        [`TEST-VENC ${nombre}`, telefono]
      );
      clientes.push(r.insertId);
      return r.insertId;
    }

    const suscribir = (clienteId, inicio, fin, opciones = {}) =>
      q(
        `INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio,
            SuscripcionFechaFin, SuscripcionEstado, SuscripcionClasesRestantes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          clienteId,
          opciones.planId || planMensual,
          inicio,
          fin,
          opciones.estado || "A",
          opciones.clases ?? 0,
        ]
      );

    /** Filas de la lista que corresponden a clientes de este test. */
    async function listar(dias = 15, clasesMin = 2) {
      const todas = await Suscripcion.getProximasAVencer(dias, null, clasesMin);
      return todas.filter((r) => clientes.includes(r.ClienteId));
    }
    const porNombre = (filas, nombre) =>
      filas.find((f) => f.ClienteNombre === `TEST-VENC ${nombre}`);

    async function limpiar() {
      for (const c of clientes) {
        await q("DELETE FROM asistencia WHERE ClienteId = ?", [c]);
        // Los pagos apuntan a la suscripción: hay que borrarlos primero o la
        // llave foránea `ipago1` bloquea el DELETE.
        await q(
          `DELETE FROM pago WHERE SuscripcionId IN (
             SELECT SuscripcionId FROM suscripcion WHERE ClienteId = ?
           )`,
          [c]
        );
        await q("DELETE FROM suscripcion WHERE ClienteId = ?", [c]);
      }
    }

    before(async () => {
      db = require("../../config/db");
      Suscripcion = require("../../models/suscripcion.model");
      dateUtils = require("../../utils/dateUtils");
      const m = await q(
        `INSERT INTO plan (PlanNombre, PlanDuracion, PlanPrecio, PlanActivo,
            PlanModalidad, PlanCantidadClases)
         VALUES ('TEST-VENC mensual', 30, 300000, 1, 'MENSUAL', 0)`
      );
      planMensual = m.insertId;
      const cl = await q(
        `INSERT INTO plan (PlanNombre, PlanDuracion, PlanPrecio, PlanActivo,
            PlanModalidad, PlanCantidadClases)
         VALUES ('TEST-VENC clases', 60, 240000, 1, 'CLASES', 12)`
      );
      planClases = cl.insertId;
    });

    after(async () => {
      if (!db) return;
      // Cada borrado va aislado: si uno falla (típicamente por una llave
      // foránea que no se anticipó) el resto igual se ejecuta. Sin esto, un
      // error a mitad de la limpieza deja filas TEST-* en la base — pasó.
      const intentar = async (sql, params) => {
        try {
          await q(sql, params);
        } catch (e) {
          console.error("limpieza:", e.message.slice(0, 80));
        }
      };
      try {
        for (const c of clientes) {
          await intentar("DELETE FROM asistencia WHERE ClienteId = ?", [c]);
          await intentar(
            `DELETE FROM pago WHERE SuscripcionId IN (
               SELECT SuscripcionId FROM suscripcion WHERE ClienteId = ?)`,
            [c]
          );
          await intentar("DELETE FROM suscripcion WHERE ClienteId = ?", [c]);
          await intentar("DELETE FROM clientes WHERE ClienteId = ?", [c]);
        }
        for (const p of [planMensual, planClases]) {
          if (p) await intentar("DELETE FROM plan WHERE PlanId = ?", [p]);
        }
      } finally {
        await db.end();
      }
    });

    beforeEach(limpiar);

    test("aparece quien vence dentro de la ventana", async () => {
      const c = await nuevoCliente("vence-pronto");
      await suscribir(c, enDias(-25), enDias(3));
      const filas = await listar(15);
      const f = porNombre(filas, "vence-pronto");
      assert.ok(f, "debería estar en la lista");
      assert.equal(f.Motivo, "VENCE");
    });

    test("no aparece quien vence más allá de la ventana", async () => {
      const c = await nuevoCliente("vence-lejos");
      await suscribir(c, enDias(-5), enDias(60));
      const filas = await listar(15);
      assert.equal(porNombre(filas, "vence-lejos"), undefined);
    });

    test("quien ya venció aparece marcado como VENCIDA", async () => {
      // Es el más urgente: ya no puede entrar.
      const c = await nuevoCliente("ya-vencio");
      await suscribir(c, enDias(-35), enDias(-3));
      const filas = await listar(15);
      const f = porNombre(filas, "ya-vencio");
      assert.ok(f);
      assert.equal(f.Motivo, "VENCIDA");
    });

    test("NO aparece quien ya renovó", async () => {
      // Escenario 2 de la tabla: el INNER JOIN toma la vigencia más lejana.
      const c = await nuevoCliente("ya-renovo");
      await suscribir(c, enDias(-30), enDias(2));
      await suscribir(c, enDias(3), enDias(33));
      const filas = await listar(15);
      const f = porNombre(filas, "ya-renovo");
      assert.equal(
        f,
        undefined,
        "llamar a alguien que ya renovó quema la lista"
      );
    });

    test("NO aparece quien tiene otro plan solapado y vigente", async () => {
      // Escenario 1: un plan vence el viernes pero otro corre hasta fin de
      // mes. El socio sigue teniendo acceso.
      const c = await nuevoCliente("solapado");
      await suscribir(c, enDias(-20), enDias(2));
      await suscribir(c, enDias(-10), enDias(45));
      const filas = await listar(15);
      assert.equal(porNombre(filas, "solapado"), undefined);
    });

    test("NO aparecen canceladas ni suspendidas", async () => {
      const a = await nuevoCliente("cancelada");
      await suscribir(a, enDias(-25), enDias(3), { estado: "C" });
      const b = await nuevoCliente("suspendida");
      await suscribir(b, enDias(-25), enDias(3), { estado: "S" });
      const filas = await listar(15);
      assert.equal(porNombre(filas, "cancelada"), undefined);
      assert.equal(porNombre(filas, "suspendida"), undefined);
    });

    test("una cancelada con fecha lejana no tapa la vigente que vence", async () => {
      // Escenario 4: si el MAX incluyera las canceladas, esta persona
      // desaparecía de la lista aunque esté a punto de quedarse afuera.
      const c = await nuevoCliente("cancelada-lejana");
      await suscribir(c, enDias(-25), enDias(3));
      await suscribir(c, enDias(-25), enDias(90), { estado: "C" });
      const filas = await listar(15);
      assert.ok(porNombre(filas, "cancelada-lejana"), "debe seguir apareciendo");
    });

    test("un plan por CLASES a punto de agotarse aparece aunque la fecha esté lejos", async () => {
      // Escenario 6, el hueco que tenía la consulta: este socio se queda sin
      // acceso en su próximo ingreso y era invisible en la lista.
      const c = await nuevoCliente("sin-clases");
      await suscribir(c, enDias(-10), enDias(50), {
        planId: planClases,
        clases: 1,
      });
      const filas = await listar(15);
      const f = porNombre(filas, "sin-clases");
      assert.ok(f, "debería estar en la lista por cupo");
      assert.equal(f.Motivo, "CLASES");
      assert.equal(Number(f.SuscripcionClasesRestantes), 1);
    });

    test("un plan por CLASES con cupo de sobra no aparece", async () => {
      const c = await nuevoCliente("clases-de-sobra");
      await suscribir(c, enDias(-10), enDias(50), {
        planId: planClases,
        clases: 10,
      });
      const filas = await listar(15);
      assert.equal(porNombre(filas, "clases-de-sobra"), undefined);
    });

    test("el umbral de clases es configurable", async () => {
      const c = await nuevoCliente("clases-cinco");
      await suscribir(c, enDias(-10), enDias(50), {
        planId: planClases,
        clases: 5,
      });
      assert.equal(
        porNombre(await listar(15, 2), "clases-cinco"),
        undefined,
        "con umbral 2 no entra"
      );
      assert.ok(
        porNombre(await listar(15, 6), "clases-cinco"),
        "con umbral 6 sí entra"
      );
    });

    test("trae el teléfono para poder llamar", async () => {
      const c = await nuevoCliente("con-telefono", "0981123456");
      await suscribir(c, enDias(-25), enDias(3));
      const f = porNombre(await listar(15), "con-telefono");
      assert.equal(f.ClienteTelefono, "0981123456");
    });

    test("quien no tiene teléfono aparece igual, con el campo vacío", async () => {
      // Escenario 8: no hay que esconderlo, hay que poder detectarlo para
      // completarle el dato.
      const c = await nuevoCliente("sin-telefono", "");
      await suscribir(c, enDias(-25), enDias(3));
      const f = porNombre(await listar(15), "sin-telefono");
      assert.ok(f, "debe aparecer");
      assert.equal(f.ClienteTelefono, "");
    });

    test("devuelve el saldo en guaraníes, no sólo PENDIENTE", async () => {
      // Escenario 9: lo que se va a cobrar es ese número.
      const c = await nuevoCliente("pago-parcial");
      const s = await suscribir(c, enDias(-25), enDias(3));
      await q(
        `INSERT INTO pago (SuscripcionId, PagoMonto, PagoTipo, PagoFecha, PagoUsuarioId)
         VALUES (?, 100000, 'CO', ?, (SELECT UsuarioId FROM usuario LIMIT 1))`,
        [s.insertId, enDias(-20)]
      );
      const f = porNombre(await listar(15), "pago-parcial");
      assert.equal(f.EstadoPago, "PENDIENTE");
      assert.equal(
        Number(f.SaldoPendiente),
        200000,
        "plan 300.000 menos 100.000 pagados"
      );
    });

    test("un plan pagado por completo muestra saldo 0", async () => {
      const c = await nuevoCliente("pagado");
      const s = await suscribir(c, enDias(-25), enDias(3));
      await q(
        `INSERT INTO pago (SuscripcionId, PagoMonto, PagoTipo, PagoFecha, PagoUsuarioId)
         VALUES (?, 300000, 'CO', ?, (SELECT UsuarioId FROM usuario LIMIT 1))`,
        [s.insertId, enDias(-20)]
      );
      const f = porNombre(await listar(15), "pagado");
      assert.equal(f.EstadoPago, "PAGADA");
      assert.equal(Number(f.SaldoPendiente), 0);
    });

    test("informa hace cuántos días no viene el socio", async () => {
      // Escenario 10: cambia la conversación. El que viene todos los días se
      // olvidó; el que no viene desde semanas ya se fue.
      const c = await nuevoCliente("no-viene");
      await suscribir(c, enDias(-25), enDias(3));
      await q(
        `INSERT INTO asistencia (ClienteId, AsistenciaFecha, AsistenciaHoraEntrada)
         VALUES (?, ?, NOW())`,
        [c, enDias(-20)]
      );
      const f = porNombre(await listar(15), "no-viene");
      assert.equal(Number(f.DiasSinVenir), 20);
      assert.ok(f.UltimaAsistencia, "debe traer la fecha de la última");
    });

    test("distingue 'nunca vino' de 'hace N días'", async () => {
      // Escenario 11: null no es lo mismo que 0.
      const c = await nuevoCliente("nunca-vino");
      await suscribir(c, enDias(-25), enDias(3));
      const f = porNombre(await listar(15), "nunca-vino");
      assert.equal(f.DiasSinVenir, null);
      assert.equal(f.UltimaAsistencia, null);
    });

    test("toma la asistencia MÁS RECIENTE, no cualquiera", async () => {
      const c = await nuevoCliente("varias-asistencias");
      await suscribir(c, enDias(-25), enDias(3));
      for (const d of [-20, -10, -2]) {
        await q(
          `INSERT INTO asistencia (ClienteId, AsistenciaFecha, AsistenciaHoraEntrada)
           VALUES (?, ?, NOW())`,
          [c, enDias(d)]
        );
      }
      const f = porNombre(await listar(15), "varias-asistencias");
      assert.equal(Number(f.DiasSinVenir), 2);
    });

    test("ordena por fecha de vencimiento, lo más urgente primero", async () => {
      const a = await nuevoCliente("orden-tarde");
      await suscribir(a, enDias(-20), enDias(10));
      const b = await nuevoCliente("orden-urgente");
      await suscribir(b, enDias(-35), enDias(-2));
      const filas = await listar(15);
      const mios = filas.filter((f) =>
        String(f.ClienteNombre).startsWith("TEST-VENC orden-")
      );
      assert.equal(mios[0].ClienteNombre, "TEST-VENC orden-urgente");
    });

    test("un socio con dos planes que terminan el mismo día aparece UNA vez", async () => {
      // Bug preexistente: el JOIN emparejaba por igualdad con
      // MAX(SuscripcionFechaFin), así que dos planes con la misma fecha de fin
      // empataban los dos y la persona salía duplicada. Dos llamadas para una
      // sola conversación. Se resolvió con DISTINCT ON + desempate por id.
      const c = await nuevoCliente("dos-mismo-fin");
      await suscribir(c, enDias(-25), enDias(3));
      await suscribir(c, enDias(-20), enDias(3));
      const filas = (await listar(15)).filter((f) => f.ClienteId === c);
      assert.equal(filas.length, 1, "una persona, una fila");
      // En el empate gana el id más alto (la carga más reciente).
      const ids = await q(
        "SELECT SuscripcionId FROM suscripcion WHERE ClienteId = ? ORDER BY SuscripcionId DESC",
        [c]
      );
      assert.equal(filas[0].SuscripcionId, ids[0].SuscripcionId);
    });

    test("los días sin venir no dependen de la zona horaria del motor", async () => {
      // Se calcula contra la fecha local del servidor pasada por parámetro, no
      // con CURRENT_DATE: si la base corriera en UTC, entre las 21:00 y las
      // 23:59 locales CURRENT_DATE ya es mañana y quien vino hoy aparecería
      // con un día de ausencia. Es el motivo por el que existe dateUtils.
      const c = await nuevoCliente("vino-hoy");
      await suscribir(c, enDias(-25), enDias(3));
      await q(
        `INSERT INTO asistencia (ClienteId, AsistenciaFecha, AsistenciaHoraEntrada)
         VALUES (?, ?, NOW())`,
        [c, enDias(0)]
      );
      const f = porNombre(await listar(15), "vino-hoy");
      assert.equal(Number(f.DiasSinVenir), 0, "vino hoy: cero días");
    });

    test("la ventana de vencidos hacia atrás es configurable", async () => {
      // Con el default de 7 días, el socio que venció hace 12 y dejó de venir
      // quedaba invisible — y es el llamado más recuperable. Lo detecté
      // corriendo el escenario real, no en los tests.
      const c = await nuevoCliente("vencio-hace-12");
      await suscribir(c, enDias(-42), enDias(-12));
      const conDefault = await Suscripcion.getProximasAVencer(15, null, 2);
      assert.equal(
        conDefault.find((f) => f.ClienteId === c),
        undefined,
        "con 7 días de vencidos no entra"
      );
      const conVentana = await Suscripcion.getProximasAVencer(15, null, 2, 30);
      assert.ok(
        conVentana.find((f) => f.ClienteId === c),
        "con 30 días de vencidos sí entra"
      );
    });

    test("el límite recorta la lista sin romper el orden", async () => {
      for (const n of [1, 2, 3]) {
        const c = await nuevoCliente(`limite-${n}`);
        await suscribir(c, enDias(-30), enDias(n));
      }
      const todas = await Suscripcion.getProximasAVencer(15, null, 2);
      const recortada = await Suscripcion.getProximasAVencer(15, 2, 2);
      assert.ok(todas.length >= 3);
      assert.equal(recortada.length, 2);
      assert.equal(recortada[0].SuscripcionId, todas[0].SuscripcionId);
    });
  }
);
