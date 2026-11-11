// Pruebas de conexion-local.ts (decisión 91): allowPublicKeyRetrieval solo con la base en la misma máquina. Sin base de datos.
import assert from "node:assert/strict";
import { esHostLocal, urlDeConexion } from "../conexion-local.ts";

let ok = 0;
const t = (nombre: string, fn: () => void) => {
  fn();
  ok++;
  console.log(`  ok   ${nombre}`);
};

t("esHostLocal: la misma máquina", () => {
  for (const h of ["127.0.0.1", "localhost", "LOCALHOST", "::1", "[::1]", " 127.0.0.1 "]) assert.ok(esHostLocal(h), h);
});
t("esHostLocal: cualquier otro host no", () => {
  for (const h of ["127.0.0.2", "10.0.0.5", "db.evaristocultural.com.ar", "localhost.example.com", "mysql", ""]) assert.ok(!esHostLocal(h), h);
});
t("urlDeConexion: base local → agrega allowPublicKeyRetrieval=true y conserva lo demás", () => {
  const r = new URL(urlDeConexion("mysql://evaristo:una%40clave@127.0.0.1:3308/evaristo_cms"));
  assert.equal(r.searchParams.get("allowPublicKeyRetrieval"), "true");
  assert.equal(r.username, "evaristo");
  assert.equal(decodeURIComponent(r.password), "una@clave");
  assert.equal(r.host, "127.0.0.1:3308");
  assert.equal(r.pathname, "/evaristo_cms");
});
t("urlDeConexion: conserva los parámetros que ya traía", () => {
  const r = new URL(urlDeConexion("mysql://u:c@localhost:3306/b?connectionLimit=5"));
  assert.equal(r.searchParams.get("connectionLimit"), "5");
  assert.equal(r.searchParams.get("allowPublicKeyRetrieval"), "true");
});
t("urlDeConexion: base en otro servidor → sin cambios (la clave pública viajaría por la red)", () => {
  for (const u of ["mysql://u:c@db.ejemplo.com:3306/b", "mysql://u:c@10.0.0.5:3306/b", "mysql://u:c@127.0.0.2:3308/b"]) assert.equal(urlDeConexion(u), u);
});
t("urlDeConexion: si la URL ya decide, se respeta (también en false)", () => {
  const u = "mysql://u:c@127.0.0.1:3308/b?allowPublicKeyRetrieval=false";
  assert.equal(urlDeConexion(u), u);
});
t("urlDeConexion: una URL que no se puede leer vuelve tal cual", () => {
  assert.equal(urlDeConexion("no es una url"), "no es una url");
});

console.log(`\n${ok} pruebas de conexión local ok`);
