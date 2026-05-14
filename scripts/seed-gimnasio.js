/**
 * Seed de datos demo para el módulo Gimnasio.
 *
 * Genera: planes, clientes, suscripciones mensuales encadenadas, pagos
 * (CO/PO/TR), asistencias y movimientos de caja (apertura/pagos/cierre)
 * sobre la BD configurada en api/.env.
 *
 * Ejecución:
 *   node scripts/seed-gimnasio.js
 *
 * El script es idempotente: borra y re-crea los datos demo (clientes ID > 2,
 * suscripciones, pagos, asistencias y registrodiariocaja). NO toca cajas,
 * usuarios, locales, productos ni cualquier otra tabla pre-existente.
 */

const path = require("path");
const apiNodeModules = path.join(__dirname, "..", "api", "node_modules");
require(path.join(apiNodeModules, "dotenv")).config({
  path: path.join(__dirname, "..", "api", ".env"),
});
const mysql = require(path.join(apiNodeModules, "mysql2", "promise"));

// -------- Config -----------
const CLIENTES_COUNT = 30;
const MESES_HISTORIA = 6;
const PROB_MOROSO = 0.20;
const CAJERO_USUARIO_ID = "faldama"; // usuario admin existente
const CAJA_ID = 4; // CAJA GIMNASIO (dedicada al módulo gimnasio)
const SEED = 20260514;

// PRNG determinista para que el seed sea reproducible
let _rng = SEED;
function rand() {
  _rng = (_rng * 1664525 + 1013904223) % 4294967296;
  return _rng / 4294967296;
}
function randInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// -------- Datos demográficos paraguayos -----------
const NOMBRES_M = ["JUAN", "CARLOS", "MIGUEL", "DIEGO", "JOSE", "LUIS", "PEDRO", "ANDRES", "FERNANDO", "RODRIGO", "MARCOS", "VICTOR", "PABLO", "GUSTAVO", "OSCAR"];
const NOMBRES_F = ["MARIA", "ANA", "LUCIA", "SOFIA", "CAMILA", "VALENTINA", "PATRICIA", "ROCIO", "FATIMA", "CLAUDIA", "LAURA", "CECILIA", "VERONICA", "GABRIELA", "NATALIA"];
const APELLIDOS = ["GONZALEZ", "RODRIGUEZ", "MARTINEZ", "LOPEZ", "BENITEZ", "FERNANDEZ", "RAMIREZ", "VERA", "AYALA", "VILLALBA", "GIMENEZ", "CACERES", "OVELAR", "ROJAS", "DUARTE", "FRANCO", "ACOSTA", "RIVEROS", "ESCOBAR", "SOSA", "ORTIZ", "MEDINA", "CABALLERO", "RUIZ", "ARGUELLO"];
const BARRIOS = ["Asunción - Villa Morra", "Asunción - Recoleta", "Asunción - Trinidad", "Lambaré - Centro", "San Lorenzo - Sajonia", "Fernando de la Mora - Zona Norte", "Luque - Mora Cué", "Mariano Roque Alonso", "Capiata - Centro", "Ñemby - Centro"];

const PLANES = [
  { nombre: "Pase Diario",        duracion: 1,   precio: 15000,  permiteClases: 0, peso: 0.05 },
  { nombre: "Mensual Básico",     duracion: 30,  precio: 150000, permiteClases: 0, peso: 0.40 },
  { nombre: "Mensual Premium",    duracion: 30,  precio: 200000, permiteClases: 1, peso: 0.35 },
  { nombre: "Trimestral",         duracion: 90,  precio: 400000, permiteClases: 1, peso: 0.15 },
  { nombre: "Semestral",          duracion: 180, precio: 750000, permiteClases: 1, peso: 0.05 },
];
function pickPlanIndexPorPeso() {
  const r = rand();
  let acc = 0;
  for (let i = 0; i < PLANES.length; i++) {
    acc += PLANES[i].peso;
    if (r <= acc) return i;
  }
  return PLANES.length - 1;
}

const PAGO_TIPOS = [
  { codigo: "CO", grupoId: 1, peso: 0.6, label: "Contado" },
  { codigo: "PO", grupoId: 4, peso: 0.25, label: "POS" },
  { codigo: "TR", grupoId: 6, peso: 0.15, label: "Transferencia" },
];
function pickPagoTipo() {
  const r = rand();
  let acc = 0;
  for (const t of PAGO_TIPOS) {
    acc += t.peso;
    if (r <= acc) return t;
  }
  return PAGO_TIPOS[0];
}

// -------- Helpers fecha -----------
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtDateTime(d) {
  return `${fmtDate(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function setTime(d, h, m, s = 0) {
  const r = new Date(d);
  r.setHours(h, m, s, 0);
  return r;
}

// -------- Main -----------
async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    dateStrings: true,
  });
  console.log(`Conectado a ${process.env.DB_NAME}`);

  await conn.beginTransaction();
  try {
    // 1) Limpieza idempotente
    console.log("Limpiando datos demo previos...");
    await conn.query("DELETE FROM registrodiariocaja WHERE CajaId = ?", [CAJA_ID]);
    await conn.query("DELETE FROM pago");
    await conn.query("DELETE FROM asistencia");
    await conn.query("DELETE FROM suscripcion");
    await conn.query("DELETE FROM clientes WHERE ClienteId > 2");
    await conn.query("DELETE FROM plan");
    await conn.query("ALTER TABLE pago AUTO_INCREMENT = 1");
    await conn.query("ALTER TABLE asistencia AUTO_INCREMENT = 1");
    await conn.query("ALTER TABLE suscripcion AUTO_INCREMENT = 1");
    await conn.query("ALTER TABLE plan AUTO_INCREMENT = 1");
    // Reset caja demo a 0
    await conn.query("UPDATE caja SET CajaMonto = 0 WHERE CajaId = ?", [CAJA_ID]);

    // 2) Planes
    console.log("Insertando planes...");
    const planIds = [];
    for (const p of PLANES) {
      const [r] = await conn.query(
        "INSERT INTO plan (PlanNombre, PlanDuracion, PlanPrecio, PlanPermiteClases, PlanActivo) VALUES (?, ?, ?, ?, 1)",
        [p.nombre, p.duracion, p.precio, p.permiteClases]
      );
      planIds.push(r.insertId);
    }

    // 3) Clientes
    console.log(`Insertando ${CLIENTES_COUNT} clientes...`);
    const clienteIds = [];
    const hoy = new Date();
    for (let i = 0; i < CLIENTES_COUNT; i++) {
      const esFem = rand() < 0.45;
      const nombre = pick(esFem ? NOMBRES_F : NOMBRES_M);
      const apellido1 = pick(APELLIDOS);
      const apellido2 = pick(APELLIDOS);
      const apellido = `${apellido1} ${apellido2}`;
      const razon = `${apellido}, ${nombre}`;
      const ci = String(1500000 + randInt(1, 4500000));
      const ruc = `${ci}-${randInt(0, 9)}`;
      const tel = `09${randInt(61, 99)}${String(randInt(100000, 999999))}`;
      const dir = pick(BARRIOS);
      const anioNac = randInt(1970, 2007);
      const mesNac = randInt(1, 12);
      const diaNac = randInt(1, 28);
      const fechaNac = `${anioNac}-${String(mesNac).padStart(2, "0")}-${String(diaNac).padStart(2, "0")}`;
      const [r] = await conn.query(
        `INSERT INTO clientes
         (ClienteRUC, ClienteRazonSocial, ClienteNombre, ClienteApellido, ClienteDireccion, ClienteTelefono, ClienteTipo, UsuarioId, ClienteFechaNacimiento)
         VALUES (?, ?, ?, ?, ?, ?, 'MI', 'admin', ?)`,
        [ruc, razon, nombre, apellido, dir, tel, fechaNac]
      );
      clienteIds.push(r.insertId);
    }

    // 4) Suscripciones + Pagos + Asistencias
    console.log("Generando suscripciones, pagos y asistencias...");
    // Mapa fecha 'YYYY-MM-DD' -> array de { pagoTipo, monto, suscripcionId, label }
    const pagosPorDia = new Map();

    const inicioRango = new Date(hoy);
    inicioRango.setMonth(inicioRango.getMonth() - MESES_HISTORIA);

    for (const clienteId of clienteIds) {
      // Primer ingreso entre inicio del rango y hace 30 días
      const offsetIngreso = randInt(0, MESES_HISTORIA * 30 - 30);
      let fechaInicio = addDays(inicioRango, offsetIngreso);

      const esMoroso = rand() < PROB_MOROSO;
      // Corte para morosos: detener renovaciones en algún punto antes de hoy
      let cortePosibleAntes = null;
      if (esMoroso) {
        const diasRango = Math.floor((hoy - fechaInicio) / (1000 * 60 * 60 * 24));
        // Cortar entre 30 y diasRango - 15 (debe quedar al menos una vencida)
        const diasCorte = Math.max(30, diasRango - randInt(15, 60));
        cortePosibleAntes = addDays(fechaInicio, diasCorte);
      }

      // Encadenar suscripciones consecutivas hasta hoy (o hasta corte si moroso)
      let planIdxActual = null;
      while (fechaInicio < hoy) {
        if (esMoroso && cortePosibleAntes && fechaInicio > cortePosibleAntes) break;

        // Elegir un plan: la primera vez al azar (ponderado), luego 70% mantiene, 30% cambia
        if (planIdxActual === null || rand() >= 0.7) {
          planIdxActual = pickPlanIndexPorPeso();
        }
        const planIdx = planIdxActual;
        const plan = PLANES[planIdx];
        const planId = planIds[planIdx];
        const fechaFin = addDays(fechaInicio, plan.duracion - 1);
        const esActivaActual = fechaFin >= hoy;
        const estado = esActivaActual ? "A" : "I";

        const [r] = await conn.query(
          `INSERT INTO suscripcion (ClienteId, PlanId, SuscripcionFechaInicio, SuscripcionFechaFin, SuscripcionEstado)
           VALUES (?, ?, ?, ?, ?)`,
          [clienteId, planId, fmtDate(fechaInicio), fmtDate(fechaFin), estado]
        );
        const suscripcionId = r.insertId;

        // Pago: usualmente en la fecha de inicio o el día anterior
        const pagoFecha = rand() < 0.85 ? new Date(fechaInicio) : addDays(fechaInicio, -1);
        // No permitir pagos en futuro
        if (pagoFecha > hoy) pagoFecha.setTime(hoy.getTime());
        const tipoPago = pickPagoTipo();
        await conn.query(
          `INSERT INTO pago (SuscripcionId, PagoMonto, PagoTipo, PagoFecha, PagoUsuarioId)
           VALUES (?, ?, ?, ?, ?)`,
          [suscripcionId, plan.precio, tipoPago.codigo, fmtDate(pagoFecha), CAJERO_USUARIO_ID]
        );
        const key = fmtDate(pagoFecha);
        if (!pagosPorDia.has(key)) pagosPorDia.set(key, []);
        pagosPorDia.get(key).push({
          pagoTipo: tipoPago,
          monto: plan.precio,
          suscripcionId,
        });

        // Asistencias: para planes >= 30 días, 3-5 por semana mientras vigente
        if (plan.duracion >= 7) {
          const limiteAsist = fechaFin < hoy ? fechaFin : hoy;
          let cursor = new Date(fechaInicio);
          while (cursor <= limiteAsist) {
            // 60% de probabilidad de asistencia en este día
            if (rand() < 0.55) {
              const h = randInt(6, 21);
              const m = randInt(0, 59);
              const entrada = setTime(cursor, h, m);
              await conn.query(
                `INSERT INTO asistencia (ClienteId, AsistenciaFecha, AsistenciaHoraEntrada)
                 VALUES (?, ?, ?)`,
                [clienteId, fmtDate(cursor), fmtDateTime(entrada)]
              );
            }
            cursor = addDays(cursor, 1);
          }
        } else {
          // Pase diario: 1 sola asistencia
          if (fechaInicio <= hoy) {
            const h = randInt(7, 20);
            const m = randInt(0, 59);
            const entrada = setTime(fechaInicio, h, m);
            await conn.query(
              `INSERT INTO asistencia (ClienteId, AsistenciaFecha, AsistenciaHoraEntrada)
               VALUES (?, ?, ?)`,
              [clienteId, fmtDate(fechaInicio), fmtDateTime(entrada)]
            );
          }
        }

        fechaInicio = addDays(fechaFin, 1);
      }
    }

    // 5) Movimientos de caja: apertura + pagos + cierre por cada día con pagos
    console.log("Generando movimientos de caja (apertura/pagos/cierre)...");
    const diasOrdenados = [...pagosPorDia.keys()].sort();
    let totalIngresosCaja = 0;
    for (const dia of diasOrdenados) {
      const pagos = pagosPorDia.get(dia);
      const apertura = new Date(`${dia}T08:00:00`);
      const cierre = new Date(`${dia}T22:00:00`);
      // Apertura (TipoGastoId=2 INGRESOS, Grupo=2 APERTURA), monto 0 — no afecta caja
      await conn.query(
        `INSERT INTO registrodiariocaja
         (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
         VALUES (?, ?, 2, 2, ?, 0, ?)`,
        [CAJA_ID, fmtDateTime(apertura), `Apertura caja ${dia}`, CAJERO_USUARIO_ID]
      );
      let totalDia = 0;
      // Pagos como movimientos de ingreso del día
      for (let i = 0; i < pagos.length; i++) {
        const p = pagos[i];
        const ts = new Date(`${dia}T${String(9 + (i % 12)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00`);
        const detalle = `Pago susc #${p.suscripcionId} - ${p.pagoTipo.label}`.slice(0, 50);
        await conn.query(
          `INSERT INTO registrodiariocaja
           (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
           VALUES (?, ?, 2, ?, ?, ?, ?)`,
          [CAJA_ID, fmtDateTime(ts), p.pagoTipo.grupoId, detalle, p.monto, CAJERO_USUARIO_ID]
        );
        totalDia += p.monto;
      }
      // Cierre: TipoGastoId=1 EGRESOS, Grupo=2 CIERRE DE CAJA, monto = total del día
      await conn.query(
        `INSERT INTO registrodiariocaja
         (CajaId, RegistroDiarioCajaFecha, TipoGastoId, TipoGastoGrupoId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto, UsuarioId)
         VALUES (?, ?, 1, 2, ?, ?, ?)`,
        [CAJA_ID, fmtDateTime(cierre), `Cierre caja ${dia}`, totalDia, CAJERO_USUARIO_ID]
      );
      totalIngresosCaja += totalDia;
    }
    // El neto sobre CajaMonto es 0 (ingresos - cierre = 0), así que no se actualiza.

    await conn.commit();
    console.log("\n=== Seed completado ===");
    console.log(`Planes:                ${planIds.length}`);
    console.log(`Clientes:              ${clienteIds.length}`);

    const [[susc]]      = await conn.query("SELECT COUNT(*) c FROM suscripcion");
    const [[pagosCnt]]  = await conn.query("SELECT COUNT(*) c, SUM(PagoMonto) s FROM pago");
    const [[asis]]      = await conn.query("SELECT COUNT(*) c FROM asistencia");
    const [[movs]]      = await conn.query("SELECT COUNT(*) c FROM registrodiariocaja WHERE CajaId = ?", [CAJA_ID]);
    const [[activas]]   = await conn.query("SELECT COUNT(*) c FROM suscripcion WHERE SuscripcionEstado='A'");

    console.log(`Suscripciones:         ${susc.c}  (activas: ${activas.c})`);
    console.log(`Pagos:                 ${pagosCnt.c}  (Gs ${Number(pagosCnt.s).toLocaleString("es-PY")})`);
    console.log(`Asistencias:           ${asis.c}`);
    console.log(`Movimientos caja #${CAJA_ID}:  ${movs.c}`);
    console.log(`Total ingresos caja:   Gs ${totalIngresosCaja.toLocaleString("es-PY")}`);
  } catch (e) {
    await conn.rollback();
    console.error("Rollback. Error:", e);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main();
