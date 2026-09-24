import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("./site/cli-proxy.pac", import.meta.url), "utf8");
const decide = (url, host) =>
  runInNewContext(`${script}\nFindProxyForURL(url, host)`, { url, host });
const host = "docker-host.mora-rattlesnake.ts.net";
const peer = "proxmox.mora-rattlesnake.ts.net";

assert.equal(decide(`https://${host}:8444/`, host), "PROXY 127.0.0.1:1055");
assert.equal(decide(`https://${host}:8443/management`, host), "PROXY 127.0.0.1:1055");
assert.equal(decide(`https://${peer}:8006/`, peer), "PROXY 127.0.0.1:1055");
assert.equal(decide(`http://${peer}:8080/`, peer), "PROXY 127.0.0.1:1055");
assert.equal(decide("https://mora-rattlesnake.ts.net/", "mora-rattlesnake.ts.net"), "DIRECT");
assert.equal(decide("https://example.com/", "example.com"), "DIRECT");
assert.equal(decide(`https://${host}.evil.test:8444/`, `${host}.evil.test`), "DIRECT");
console.log("work PAC routing rules valid");
