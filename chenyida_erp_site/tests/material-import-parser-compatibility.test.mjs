import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { Miniflare } from "miniflare";

import { R2MaterialImportObjectStore } from "../app/lib/material-import/object-store.ts";

const siteRoot = resolve(new URL("../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
async function packageMetadata(relativePath) {
  return JSON.parse(await readFile(resolve(siteRoot, relativePath), "utf8"));
}

test("parser dependencies are pinned and use approved licenses", async () => {
  const [zip, sax, csv] = await Promise.all([
    packageMetadata("node_modules/@zip.js/zip.js/package.json"),
    packageMetadata("node_modules/sax-wasm/package.json"),
    packageMetadata("node_modules/csv-parse/package.json"),
  ]);
  assert.deepEqual(
    [
      [zip.name, zip.version, zip.license],
      [sax.name, sax.version, sax.license],
      [csv.name, csv.version, csv.license],
    ],
    [
      ["@zip.js/zip.js", "2.8.26", "BSD-3-Clause"],
      ["sax-wasm", "3.1.4", "MIT"],
      ["csv-parse", "7.0.1", "MIT"],
    ],
  );
});

test("R2 adapter forwards bounded range reads without buffering", async () => {
  let receivedRange;
  const bucket = {
    async head() { return null; },
    async put() { throw new Error("not used"); },
    async delete() {},
    async get(key, options) {
      assert.equal(key, "test/materials.xlsx");
      receivedRange = options?.range;
      return {
        key,
        size: 3,
        etag: "test-etag",
        body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([2, 3, 4])); controller.close(); } }),
      };
    },
  };
  const stream = await new R2MaterialImportObjectStore(bucket).open("test/materials.xlsx", { offset: 2, length: 3 });
  assert.deepEqual(receivedRange, { offset: 2, length: 3 });
  assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()), new Uint8Array([2, 3, 4]));
});

test("approved parser stack bundles and executes in Miniflare with local WASM", async () => {
  const source = String.raw`
    import { configure, TextReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
    import { parse } from "csv-parse/browser/esm";
    import { SAXParser, SaxEventType } from "sax-wasm";
    import saxWasm from "./sax-wasm.wasm";

    configure({ useWebWorkers: false });
    const encoder = new TextEncoder();

    async function parseCsv() {
      return new Promise((resolve, reject) => {
        const records = [];
        const parser = parse({ delimiter: ",", relax_column_count: true });
        parser.on("readable", () => { let record; while ((record = parser.read()) !== null) records.push(record); });
        parser.on("error", reject);
        parser.on("end", () => resolve(records));
        parser.write('code,name\r\n"001');
        parser.write('23","line 1\nline 2"\r\n');
        parser.end();
      });
    }

    async function parseZip() {
      const output = new Uint8ArrayWriter();
      const writer = new ZipWriter(output);
      await writer.add("xl/worksheets/sheet1.xml", new TextReader("<sheet><row>ok</row></sheet>"), { level: 6 });
      const archive = await writer.close();
      const reader = new ZipReader(new Uint8ArrayReader(archive));
      const entries = await reader.getEntries();
      const text = await entries[0].getData(new TextWriter());
      await reader.close();
      return { archiveBytes: archive.byteLength, name: entries[0].filename, text };
    }

    async function parseXml() {
      const names = [];
      const parser = new SAXParser(SaxEventType.OpenTag | SaxEventType.CloseTag | SaxEventType.Text);
      parser.eventHandler = (event, detail) => { if (event === SaxEventType.OpenTag) names.push(detail.name); };
      if (!(await parser.prepareWasm(saxWasm))) throw new Error("SAX_WASM_PREPARE_FAILED");
      parser.write(encoder.encode("<work"));
      parser.write(encoder.encode("book><sheet>ok</sheet></workbook>"));
      parser.end();
      return names;
    }

    export default {
      async fetch() {
        let cancelled = false;
        const reader = new ReadableStream({ cancel() { cancelled = true; } }).getReader();
        await reader.cancel("compatibility-test");
        const [csv, zip, xml] = await Promise.all([parseCsv(), parseZip(), parseXml()]);
        return Response.json({ csv, zip, xml, cancelled });
      },
    };
  `;

  const result = await build({
    absWorkingDir: siteRoot,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    stdin: { contents: source, loader: "ts", resolveDir: siteRoot, sourcefile: "compatibility-worker.ts" },
    external: ["./sax-wasm.wasm"],
  });
  const javascript = result.outputFiles.find((file) => file.path.endsWith("<stdout>"))?.text ?? result.outputFiles[0].text;
  const wasm = new Uint8Array(await readFile(resolve(siteRoot, "node_modules/sax-wasm/lib/sax-wasm.wasm")));
  assert.ok(Buffer.byteLength(javascript) < 2 * 1024 * 1024, "compatibility bundle must stay below 2 MiB");
  assert.ok(wasm.byteLength < 1024 * 1024, "sax-wasm binary must stay below 1 MiB");

  const before = process.memoryUsage().heapUsed;
  const miniflare = new Miniflare({
    compatibilityDate: "2026-05-22",
    compatibilityFlags: ["nodejs_compat"],
    modules: [
      { type: "ESModule", path: "compatibility-worker.mjs", contents: javascript },
      { type: "CompiledWasm", path: "sax-wasm.wasm", contents: wasm },
    ],
  });
  try {
    const response = await miniflare.dispatchFetch("http://local.test/");
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const body = JSON.parse(responseText);
    assert.deepEqual(body.csv, [["code", "name"], ["00123", "line 1\nline 2"]]);
    assert.equal(body.zip.name, "xl/worksheets/sheet1.xml");
    assert.equal(body.zip.text, "<sheet><row>ok</row></sheet>");
    assert.deepEqual(body.xml, ["workbook", "sheet"]);
    assert.equal(body.cancelled, true);
  } finally {
    await miniflare.dispose();
  }
  const heapDelta = Math.max(0, process.memoryUsage().heapUsed - before);
  assert.ok(heapDelta < 64 * 1024 * 1024, `compatibility probe heap delta ${heapDelta} exceeds 64 MiB`);
});
