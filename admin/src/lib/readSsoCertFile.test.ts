import test from "node:test";
import assert from "node:assert/strict";
import { readSsoCertFile } from "./readSsoCertFile";

test("readSsoCertFile accepts PEM text", async () => {
  const pem = `-----BEGIN CERTIFICATE-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1L7VLPHCgc7jRpSx
GQIBAQKBgQDfabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX
YZ0123456789+/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKL
abcdefghijklmnop
-----END CERTIFICATE-----`;
  const file = new File([pem], "idp.pem", { type: "application/x-pem-file" });
  const result = await readSsoCertFile(file);
  assert.match(result, /BEGIN CERTIFICATE/);
  assert.match(result, /END CERTIFICATE/);
});

test("readSsoCertFile wraps bare base64 as PEM", async () => {
  const body =
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu1SU1L7VLPHCgc7jRpSxGQIBAQKBgQDfabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLabcdefghijklmnop";
  const file = new File([body], "idp.cer", { type: "application/pkix-cert" });
  const result = await readSsoCertFile(file);
  assert.equal(result.startsWith("-----BEGIN CERTIFICATE-----"), true);
  assert.ok(result.includes(body.slice(0, 64)));
});

test("readSsoCertFile converts DER binary to PEM", async () => {
  // Minimal pseudo-DER payload that is not UTF-8 text / not base64.
  const der = Uint8Array.from([0x30, 0x82, 0x01, 0x0a, ...Array.from({ length: 120 }, (_, i) => (i * 7) % 256)]);
  const file = new File([der], "idp.cer", { type: "application/pkix-cert" });
  const result = await readSsoCertFile(file);
  assert.match(result, /^-----BEGIN CERTIFICATE-----\n/);
  assert.match(result, /\n-----END CERTIFICATE-----$/);
  const body = result
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  assert.equal(body, Buffer.from(der).toString("base64"));
});
