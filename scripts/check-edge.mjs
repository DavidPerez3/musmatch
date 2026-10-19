// Check the Edge handler without executing it or downloading a second client.
import ts from "typescript";
import { readFile } from "node:fs/promises";
import path from "node:path";
const sourcePath = "supabase/functions/place-search/index.ts";
const virtualPath = path.resolve(".edge-check.ts");
const source =
  (await readFile(sourcePath, "utf8")).replace(
    "npm:@supabase/supabase-js@2.89.0",
    "@supabase/supabase-js",
  ) +
  `\ndeclare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Response|Promise<Response>):void};`;
const options = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};
const host = ts.createCompilerHost(options),
  original = host.getSourceFile.bind(host);
host.getSourceFile = (file, ...args) =>
  path.resolve(file) === virtualPath
    ? ts.createSourceFile(file, source, options.target, true)
    : original(file, ...args);
const program = ts.createProgram([virtualPath], options, host),
  diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (f) => f.replace(".edge-check.ts", sourcePath),
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    }),
  );
  process.exit(1);
}
console.log("Edge handler types checked");
