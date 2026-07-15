import {
  TextWriter,
  Uint8ArrayReader,
  ZipReader,
  configure,
} from "@zip.js/zip.js";
import { parse } from "csv-parse/browser/esm";
import { SAXParser, SaxEventType } from "sax-wasm";

configure({ useWebWorkers: false });

export async function typecheckApprovedParserStack(
  archive: Uint8Array,
  saxModule: WebAssembly.Module,
): Promise<readonly string[]> {
  const zip = new ZipReader(new Uint8ArrayReader(archive));
  const entries = await zip.getEntries();
  const names: string[] = [];
  for (const entry of entries) {
    names.push(entry.filename);
    if ("getData" in entry) await entry.getData(new TextWriter());
  }
  await zip.close();

  const sax = new SAXParser(SaxEventType.OpenTag | SaxEventType.CloseTag | SaxEventType.Text);
  await sax.prepareWasm(saxModule);
  sax.write(new Uint8Array());
  sax.end();

  const csv = parse({ delimiter: [",", "\t", ";"] });
  csv.write("code,name\n00123,test\n");
  csv.end();
  return names;
}
