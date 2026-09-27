import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("./site/cli-proxy.pac", import.meta.url), "utf8");
const decide = (url, host) =>
  runInNewContext(`${script}\nFindProxyForURL(url, host)`, { url, host });
const host = "llm.ts.diloreto.com";
const oldHost = "docker-host.mora-rattlesnake.ts.net";
const peer = "proxmox.mora-rattlesnake.ts.net";

assert.equal(decide(`https://${host}/v1/models`, host), "PROXY 127.0.0.1:1055");
assert.equal(decide(`https://${host}:443/management.html`, host), "PROXY 127.0.0.1:1055");
assert.equal(decide("https://omada.ts.diloreto.com/", "omada.ts.diloreto.com"), "PROXY 127.0.0.1:1055");
assert.equal(decide("https://radarr.ts.diloreto.com/", "radarr.ts.diloreto.com"), "PROXY 127.0.0.1:1055");
assert.equal(decide(`https://${host}.evil.test/`, host), "DIRECT");
assert.equal(decide(`https://${host}:8444/`, host), "DIRECT");
assert.equal(decide(`http://${host}/`, host), "DIRECT");
assert.equal(decide("https://omada.ts.diloreto.com:8443/", "omada.ts.diloreto.com"), "DIRECT");
assert.equal(decide("https://ts.diloreto.com/", "ts.diloreto.com"), "DIRECT");
assert.equal(decide(`https://${oldHost}:8444/`, oldHost), "DIRECT");
assert.equal(decide(`https://${peer}:8006/`, peer), "DIRECT");
assert.equal(decide("https://mora-rattlesnake.ts.net/", "mora-rattlesnake.ts.net"), "DIRECT");
assert.equal(decide("https://example.com/", "example.com"), "DIRECT");
assert.equal(decide(`https://${host}.evil.test/`, `${host}.evil.test`), "DIRECT");
console.log("work PAC routing rules valid");
