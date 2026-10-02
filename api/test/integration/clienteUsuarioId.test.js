// Regresión del PUT /api/clientes/:id que devolvía 500.
//
// `clientes.usuarioid` es FK a `usuario.usuarioid` (constraint `iclientes1`).
// La columna admite NULL, pero el formulario de clientes manda
// `UsuarioId: ""` cuando el cliente no tiene usuario asignado (los 692 de la
// base están en NULL). MySQL toleraba la cadena vacía; Postgres la rechaza con
// 23503 → el controlador caía en el catch genérico y devolvía
// "Error al actualizar cliente" sin más pista.
//
// Escribe y restaura: guarda el estado del cliente antes de tocarlo y lo
// vuelve a dejar como estaba, pase lo que pase.
//
// Requiere base. Se saltea salvo que se corra con RUN_DB_TESTS=1:
//   RUN_DB_TESTS=1 node --test test/integration/
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

const HABILITADO = process.env.RUN_DB_TESTS === "1";

describe(
  "UsuarioId vacío no rompe el alta/edición de clientes",
  { skip: HABILITADO ? false : "definir RUN_DB_TESTS=1 para correr con base" },
  () => {
    let db, Cliente, creados = [];

    before(() => {
      db = require("../../config/db");
      Cliente = require("../../models/cliente.model");
    });

    after(async () => {
      for (const id of creados) {
        await new Promise((res) =>
          db.query("DELETE FROM clientes WHERE ClienteId = ?", [id], () => res())
        );
      }
      if (db) await db.end();
    });

    test("create con UsuarioId '' guarda NULL en vez de violar la FK", async () => {
      const creado = await Cliente.create({
        ClienteRUC: "",
        ClienteNombre: "TEST USUARIOID VACIO",
        ClienteApellido: "",
        ClienteTipo: "MI",
        UsuarioId: "",
      });
      creados.push(creado.ClienteId);

      const enBase = await Cliente.getById(creado.ClienteId);
      assert.equal(enBase.UsuarioId, null);
    });

    test("update con UsuarioId '' actualiza el resto de los campos", async () => {
      const creado = await Cliente.create({
        ClienteRUC: "",
        ClienteNombre: "TEST UPDATE",
        ClienteApellido: "",
        ClienteTipo: "MI",
        UsuarioId: "",
      });
      creados.push(creado.ClienteId);

      const actualizado = await Cliente.update(creado.ClienteId, {
        ClienteNombre: "TEST UPDATE EDITADO",
        ClienteTelefono: "0972105842",
        UsuarioId: "",
      });

      assert.ok(actualizado, "el update no debería devolver null");
      assert.equal(actualizado.ClienteNombre, "TEST UPDATE EDITADO");
      assert.equal(actualizado.ClienteTelefono, "0972105842");
      assert.equal(actualizado.UsuarioId, null);
    });

    test("un UsuarioId real se sigue guardando tal cual", async () => {
      const usuarios = await new Promise((res, rej) =>
        db.query("SELECT UsuarioId FROM usuario LIMIT 1", [], (e, r) =>
          e ? rej(e) : res(r)
        )
      );
      assert.ok(usuarios.length, "se necesita al menos un usuario en la base");
      const usuarioId = usuarios[0].UsuarioId;

      const creado = await Cliente.create({
        ClienteRUC: "",
        ClienteNombre: "TEST USUARIOID REAL",
        ClienteApellido: "",
        ClienteTipo: "MI",
        UsuarioId: ` ${usuarioId} `,
      });
      creados.push(creado.ClienteId);

      const enBase = await Cliente.getById(creado.ClienteId);
      assert.equal(enBase.UsuarioId, usuarioId);
    });
  }
);
