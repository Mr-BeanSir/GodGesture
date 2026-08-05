import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const demoRoot = resolve(root, "plugins", "gesture-demo");
const source = await readFile(join(demoRoot, "index.mjs"), "utf8");
const manifest = JSON.parse(await readFile(join(demoRoot, "package.json"), "utf8"));
const lifecycleExports = [
  "onInit",
  "onExecute",
  "onGestureRecognized",
  "onModifierTriggered",
  "onEnd",
];
const expectedActions = [
  { id: "init", name: "初始化", export: "onInit" },
  { id: "default", name: "执行", export: "onExecute" },
  { id: "gestureRecognized", name: "手势识别", export: "onGestureRecognized" },
  { id: "modifierTriggered", name: "修饰符触发", export: "onModifierTriggered" },
  { id: "end", name: "结束", export: "onEnd" },
];

assert.equal(manifest.type, "module");
assert.equal(manifest.dependencies, undefined);
assert.deepEqual(manifest.devDependencies, { "@godgesture/sdk": "0.1.0" });
assert.equal(manifest.scripts, undefined);
assert.deepEqual(manifest.godgesture.actions, expectedActions);
assert.match(source, /[\u3400-\u9fff]/u, "gesture-demo 必须包含中文注释");

const temporaryRoot = await mkdtemp(join(tmpdir(), "godgesture-gesture-demo-"));
try {
  await copyFile(join(demoRoot, "index.mjs"), join(temporaryRoot, "index.mjs"));
  await copyFile(join(demoRoot, "package.json"), join(temporaryRoot, "package.json"));
  const sdkRoot = join(temporaryRoot, "node_modules", "@godgesture", "sdk");
  await mkdir(sdkRoot, { recursive: true });
  await writeFile(
    join(sdkRoot, "package.json"),
    JSON.stringify({
      name: "@godgesture/sdk",
      type: "module",
      exports: { import: "./index.mjs" },
    }),
  );
  await copyFile(
    resolve(root, "apps", "desktop", "node-host", "sdk.mjs"),
    join(sdkRoot, "index.mjs"),
  );

  const plugin = await import(pathToFileURL(join(temporaryRoot, "index.mjs")).href);
  assert.deepEqual(Object.keys(plugin).sort(), [...lifecycleExports].sort());
  for (const name of lifecycleExports) assert.equal(typeof plugin[name], "function");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("gesture-demo: 5 个 onXxx 生命周期导出验证通过");
