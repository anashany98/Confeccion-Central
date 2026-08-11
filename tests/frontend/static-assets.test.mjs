import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const central = fs.readFileSync("app/static/central.js", "utf8");
const index = fs.readFileSync("app/static/index.html", "utf8");
const serviceWorker = fs.readFileSync("app/static/sw.js", "utf8");

test("las mutaciones incluyen protección CSRF", () => {
  assert.match(central, /X-CSRF-Token/);
  assert.match(central, /csrf_token/);
});

test("las obras no se persisten en localStorage", () => {
  assert.doesNotMatch(index, /localStorage\.setItem\(JOBS_KEY/);
  assert.doesNotMatch(index, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(index, /clearSensitiveState/);
});

test("Excel se sirve localmente y entra en la caché PWA", () => {
  assert.match(index, /\/static\/vendor\/xlsx\.full\.min\.js/);
  assert.match(serviceWorker, /\/static\/vendor\/xlsx\.full\.min\.js/);
  assert.doesNotMatch(index, /cdn\.jsdelivr\.net/);
});

test("las respuestas API no se almacenan en la caché", () => {
  assert.match(serviceWorker, /url\.pathname\.startsWith\(["']\/api\/["']\)/);
});

test("los avisos de ancho/alto de corte vs ancho de tela llegan a la revisión visual", () => {
  assert.match(index, /Ancho de corte .*excede el ancho de tela/);
  assert.match(index, /Alto de corte .*no cabe en el ancho de tela/);
  assert.match(index, /t\.includes\('ancho de tela'\)/);
});

test("el modal de trabajos separa los propios de los de compañeros", () => {
  assert.match(index, /data-job-scope="mine"/);
  assert.match(index, /data-job-scope="others"/);
  assert.match(index, /Mis trabajos/);
  assert.match(index, /Compañeros/);
  assert.match(index, /setOthersJobs/);
  assert.match(central, /scope=others/);
  assert.match(central, /isReadOnlyJob/);
});

test("los scripts embebidos son JavaScript válido", () => {
  const scripts = [
    ...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
  ].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
});
