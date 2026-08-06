import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [
  workbench,
  globals,
  materialShell,
  materials,
  projects,
  planning,
  sourcing,
  supplierMappings,
  legacyHtml,
  legacyStyles,
  legacyApp,
  dashboardService,
] = await Promise.all([
  read("../app/_components/erp-workbench.tsx"),
  read("../app/globals.css"),
  read("../app/materials/_components/material-shell.tsx"),
  read("../app/materials/materials.css"),
  read("../app/projects/projects.css"),
  read("../app/planning/planning.css"),
  read("../app/procurement/sourcing/sourcing.css"),
  read("../app/procurement/supplier-mappings/supplier-mappings.css"),
  read("../public/erp/index.html"),
  read("../public/erp/styles.css"),
  read("../public/erp/app.js"),
  read("../app/lib/dashboard-selfhost/service.ts"),
]);

test("enterprise theme defines one blue-gray visual language with accessible interaction states", () => {
  for (const token of ["--erp-bg", "--erp-surface", "--erp-text", "--erp-muted", "--erp-border", "--erp-primary", "--erp-navy", "--erp-success", "--erp-warning", "--erp-danger"]) {
    assert.ok(globals.includes(token), token);
  }
  assert.match(globals, /--erp-primary:\s*#2468c5/);
  assert.match(globals, /:focus-visible/);
  assert.match(globals, /prefers-reduced-motion:\s*reduce/);
  assert.match(globals, /@media \(max-width: 720px\)/);
  assert.match(globals, /@media \(max-width: 560px\)/);
  assert.doesNotMatch(globals, /url\(/);
});

test("root authentication and workbench use branded enterprise shells without changing auth routes", () => {
  for (const className of ["wb-auth-layout", "wb-auth-brand", "wb-auth-capabilities", "wb-auth-panel", "wb-header-brand", "wb-contextbar", "wb-authority"]) {
    assert.ok(workbench.includes(className), className);
  }
  for (const route of ["/api/session", "/api/login", "/api/setup", "/api/me/password", "/api/logout"]) {
    assert.ok(workbench.includes(route) || (route === "/api/logout" && workbench.includes("logoutSession")), route);
  }
  assert.match(workbench, /autoComplete="username"/);
  assert.match(workbench, /autoComplete="current-password"/);
  assert.match(workbench, /data-cyd-protected-view/);
  assert.doesNotMatch(workbench, /yonyou|用友|<img|backgroundImage/i);
});

test("native business shells share the design tokens and compact navigation patterns", () => {
  assert.match(materialShell, /mm-brand-mark/);
  assert.match(materialShell, /mm-nav-section-first/);
  for (const [name, source] of Object.entries({ materials, projects, planning, sourcing, supplierMappings })) {
    assert.match(source, /var\(--erp-(?:primary|bg|border|text|surface)/, name);
    assert.match(source, /border-radius:\s*(?:5px|6px|8px|var\(--erp-radius)/, name);
  }
  assert.match(materials, /@media \(max-width: 560px\)/);
  assert.match(planning, /@media\(max-width:420px\)/);
  assert.match(sourcing, /@media\(max-width:600px\)/);
});

test("legacy shell uses the same identity and one cache-busted asset release", () => {
  assert.match(legacyHtml, /class="brand-lockup"/);
  assert.match(legacyHtml, /class="brand-mark"/);
  assert.match(legacyHtml, /class="nav-section">工作门户/);
  assert.match(legacyStyles, /--brand:\s*#2468c5/);
  assert.match(legacyStyles, /\.auth-shell/);
  assert.match(legacyStyles, /\.auth-brand/);
  assert.match(legacyStyles, /:focus-visible/);
  const release = "20260806-enterprise-ui-refresh-01";
  for (const source of [legacyHtml, legacyApp, workbench, dashboardService]) assert.ok(source.includes(release));
  assert.doesNotMatch(`${legacyHtml}\n${legacyStyles}`, /yonyou|用友|https?:\/\/.*\.(?:png|jpe?g|svg)/i);
});
