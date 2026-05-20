// Reconstruye `cancha_credito` para reservas que ya fueron cobradas con CR
// ANTES de que existiera el sistema de créditos de cancha (migración 009).
//
// Estrategia: escanear `registrodiariocaja` con TipoGastoGrupoId=7 (COBRO
// CANCHA) y detalle que arranque con "Crédito" — extraer el ReservaId del
// patrón "#<id>" al final del detalle y crear la entrada en cancha_credito
// si todavía no existe (idempotente).
//
// Uso: node api/scripts/reconstruir-creditos-cancha.js
require("dotenv").config();
const db = require("../config/db");

async function main() {
  const connection = await db.promise().getConnection();
  try {
    // Detectar movimientos histories de crédito en cancha. Detalle típico:
    // "Crédito FERNANDO LOPEZ MARTINEZ #294" o "Crédito  #294" (caso del
    // bug del JOIN faltante donde no salió el nombre).
    const [movs] = await connection.query(
      `SELECT RegistroDiarioCajaId, RegistroDiarioCajaDetalle, RegistroDiarioCajaMonto,
              RegistroDiarioCajaFecha, UsuarioId
       FROM registrodiariocaja
       WHERE TipoGastoGrupoId = 7
         AND RegistroDiarioCajaDetalle LIKE 'Crédito%'
       ORDER BY RegistroDiarioCajaId ASC`
    );

    console.log(`Encontrados ${movs.length} movimientos de Crédito en cancha.\n`);

    let creados = 0;
    let saltados = 0;
    for (const m of movs) {
      const detalle = m.RegistroDiarioCajaDetalle || "";
      const match = detalle.match(/#(\d+)\s*$/);
      if (!match) {
        console.log(`⚠ No se pudo extraer ReservaId de: "${detalle}" (skip)`);
        continue;
      }
      const reservaId = parseInt(match[1], 10);
      const monto = Number(m.RegistroDiarioCajaMonto) || 0;

      // Si ya existe un crédito para esta reserva, saltamos (idempotencia).
      const [exist] = await connection.query(
        "SELECT CanchaCreditoId FROM cancha_credito WHERE CanchaReservaId = ?",
        [reservaId]
      );
      if (exist.length > 0) {
        saltados++;
        continue;
      }

      // Traer ClienteId de la reserva. Si la reserva no tiene cliente
      // (invitado), saltamos con warning — no debería existir porque hoy
      // bloqueamos CR sin cliente, pero por defensa.
      const [resRows] = await connection.query(
        "SELECT ClienteId FROM cancha_reserva WHERE CanchaReservaId = ?",
        [reservaId]
      );
      if (resRows.length === 0) {
        console.log(`⚠ Reserva #${reservaId} no existe en BD (skip)`);
        continue;
      }
      const clienteId = resRows[0].ClienteId;
      if (!clienteId) {
        console.log(`⚠ Reserva #${reservaId} sin ClienteId (skip)`);
        continue;
      }

      await connection.query(
        `INSERT INTO cancha_credito
         (CanchaReservaId, ClienteId, CanchaCreditoMonto, CanchaCreditoSaldo,
          CanchaCreditoFecha, CanchaCreditoPagoCant, UsuarioId)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [reservaId, clienteId, monto, monto, m.RegistroDiarioCajaFecha, m.UsuarioId]
      );
      console.log(
        `✓ Reserva #${reservaId} | Cliente ${clienteId} | Gs. ${monto.toLocaleString("es-PY")} creado`
      );
      creados++;
    }

    console.log(`\nResumen: ${creados} creados, ${saltados} ya existían.`);
  } catch (e) {
    console.error("Error:", e);
    process.exitCode = 1;
  } finally {
    connection.release();
    process.exit();
  }
}

main();
