// scripts/check-dist.mjs : tests négatifs sur un dist/ factice
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

// prettier-ignore
// @ts-expect-error script Node sans types
import { checkDist, checkHtml, readAllowlist } from "../../scripts/check-dist.mjs";

const PAGE =
  '<!doctype html><html><head><script src="./theme-init.js"></script></head><body><div id="root"></div></body></html>';

function dist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "check-dist-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const options = { allowlist: ["http://www.w3.org/2000/svg/"], worklet: "" };

describe("check-dist", () => {
  test("test_checkDist_build_propre_aucun_probleme", () => {
    const dir = dist({
      "index.html": PAGE,
      "assets/app.js": 'const ns = "http://www.w3.org/2000/svg"; x={data:1}',
    });
    expect(checkDist(dir, options)).toEqual([]);
  });

  test.each([
    ["<script>alert(1)</script>", "script en ligne"],
    ['<script src="a.js">alert(1)</script>', "script en ligne"],
    ["<style>body{}</style>", "balise <style>"],
    ['<div style="color:red"></div>', "attribut style="],
    ['<button onclick="x()"></button>', "attribut on*="],
  ])("test_checkHtml_%s_refuse", (html, problem) => {
    expect(checkHtml(html)).toContain(problem);
  });

  test("test_checkDist_url_data_refusee", () => {
    const dir = dist({
      "index.html": PAGE,
      "assets/app.css": ".a{background:url(data:image/png;base64,AAAA)}",
    });
    expect(checkDist(dir, options)).toEqual(["assets/app.css : URL data:"]);
  });

  test("test_checkDist_url_hors_liste_refusee", () => {
    const dir = dist({
      "index.html": PAGE,
      "assets/app.js": 'fetch("https://cdn.example.org/x.js")',
    });
    expect(checkDist(dir, options)).toEqual([
      "assets/app.js : URL hors liste https://cdn.example.org/x.js",
    ]);
  });

  test("test_checkDist_worklet_modifie_refuse", () => {
    const source = dist({ "capture-worklet.js": "registerProcessor('a', A);" });
    const worklet = join(source, "capture-worklet.js");
    const absent = dist({ "index.html": PAGE });
    expect(checkDist(absent, { ...options, worklet })).toEqual([
      "capture-worklet.js absent",
    ]);
    const changed = dist({
      "index.html": PAGE,
      "capture-worklet.js": "registerProcessor('b', B);",
    });
    expect(checkDist(changed, { ...options, worklet })).toEqual([
      "capture-worklet.js différent de frontend/",
    ]);
  });

  test("test_checkDist_url_relative_au_protocole_refusee", () => {
    const dir = dist({
      "index.html":
        '<!doctype html><script src="//cdn.example.org/x.js"></script>',
      "assets/app.css": ".a{background:url(//cdn.example.org/a.png)}",
    });
    expect(checkDist(dir, options).sort()).toEqual([
      "assets/app.css : URL relative au protocole url(//cdn.example.org",
      'index.html : URL relative au protocole src="//cdn.example.org',
    ]);
  });

  test("test_checkDist_fichier_mjs_et_map_controles", () => {
    const dir = dist({
      "index.html": PAGE,
      "assets/a.mjs": 'import("https://evil.example/x.js")',
    });
    expect(checkDist(dir, options)).toEqual([
      "assets/a.mjs : URL hors liste https://evil.example/x.js",
    ]);
  });

  test("test_readAllowlist_prefixe_termine_par_slash", () => {
    const dir = dist({
      "allow.txt": "# commentaire\nhttps://tailwindcss.com\n",
    });
    const allowlist = readAllowlist(join(dir, "allow.txt"));
    expect(allowlist).toEqual(["https://tailwindcss.com/"]);
    const built = dist({
      "index.html": PAGE,
      "assets/a.js": '"https://tailwindcss.com.evil.tld/x"',
    });
    expect(checkDist(built, { allowlist, worklet: "" })).toHaveLength(1);
  });
});
