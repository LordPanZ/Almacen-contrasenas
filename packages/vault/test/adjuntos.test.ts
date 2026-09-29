import { describe, expect, it } from "vitest";
import { AeadError, SecretBuffer, randomBytes, toHex } from "@cerbero/crypto";
import {
  MAX_ATTACHMENT_BYTES,
  createVault,
  openAttachment,
  packAttachments,
  sealAttachment,
  unpackAttachments,
  unlockVault,
} from "../src/index.ts";

const clave = () => SecretBuffer.fromText("correcto caballo grapa");
const nueva = () => createVault(clave(), { argon2Profile: "test" });

describe("documentos adjuntos", () => {
  it("un documento cifrado se recupera idéntico", () => {
    const { vault } = nueva();
    const original = randomBytes(150_000);
    const { id, sealed } = vault.sealAttachment(original);
    expect(toHex(vault.openAttachment(id, sealed))).toBe(toHex(original));
    vault.lock();
  });

  it("el criptograma no contiene el documento en claro", () => {
    const { vault } = nueva();
    const marca = new TextEncoder().encode("ESCRITURA DE PROPIEDAD nº 4471 DNI 12345678Z");
    const original = new Uint8Array(4000);
    original.set(marca, 100);
    const { sealed } = vault.sealAttachment(original);
    expect(toHex(sealed)).not.toContain(toHex(marca));
    vault.lock();
  });

  it("el tamaño del criptograma cae en un cubo y no delata el del original", () => {
    const { vault } = nueva();
    const a = vault.sealAttachment(randomBytes(70_000)).sealed.length;
    const b = vault.sealAttachment(randomBytes(120_000)).sealed.length;
    // Ambos caen en el mismo cubo de 128 KiB.
    expect(a).toBe(b);
    vault.lock();
  });

  it("no se abre con otra bóveda aunque se tenga el identificador", () => {
    const una = nueva().vault;
    const otra = nueva().vault;
    const { id, sealed } = una.sealAttachment(randomBytes(5000));
    expect(() => otra.openAttachment(id, sealed)).toThrow(AeadError);
  });

  it("no se puede hacer pasar un documento por otro", () => {
    const { vault } = nueva();
    const a = vault.sealAttachment(randomBytes(3000));
    const b = vault.sealAttachment(randomBytes(3000));
    expect(() => vault.openAttachment(b.id, a.sealed)).toThrow(AeadError);
  });

  it("detecta un byte alterado", () => {
    const { vault } = nueva();
    const { id, sealed } = vault.sealAttachment(randomBytes(3000));
    const roto = Uint8Array.from(sealed);
    roto[100] = (roto[100] as number) ^ 1;
    expect(() => vault.openAttachment(id, roto)).toThrow(AeadError);
  });

  it("abrir una bóveda ya guardada sigue descifrando sus documentos", () => {
    const { vault, file } = nueva();
    void file;
    const original = randomBytes(9000);
    const { id, sealed } = vault.sealAttachment(original);
    const guardado = vault.serialize();
    vault.lock();
    const reabierta = unlockVault(guardado, clave());
    expect(toHex(reabierta.openAttachment(id, sealed))).toBe(toHex(original));
    reabierta.lock();
  });

  it("rechaza un documento vacío o por encima del tope", () => {
    const { vault } = nueva();
    expect(() => vault.sealAttachment(new Uint8Array(0))).toThrow(/vacío/);
    expect(() => vault.sealAttachment(new Uint8Array(MAX_ATTACHMENT_BYTES + 1))).toThrow(/máximo/);
    vault.lock();
  });

  it("una clave de datos distinta no abre el documento", () => {
    const { vault } = nueva();
    const original = randomBytes(2000);
    const { id, sealed } = vault.sealAttachment(original);
    expect(() => openAttachment(new Uint8Array(32), vault.vaultId, id, sealed)).toThrow(AeadError);
  });
});

describe("copia de seguridad de documentos", () => {
  const item = (n: number) => ({
    id: toHex(randomBytes(16)),
    sealed: randomBytes(n),
  });

  it("empaquetar y desempaquetar devuelve lo mismo", () => {
    const originales = [item(100), item(5000), item(1)];
    const vueltos = unpackAttachments(packAttachments(originales));
    expect(vueltos.map((v) => v.id)).toEqual(originales.map((o) => o.id));
    expect(vueltos.map((v) => toHex(v.sealed))).toEqual(originales.map((o) => toHex(o.sealed)));
  });

  it("un paquete vacío es válido", () => {
    expect(unpackAttachments(packAttachments([]))).toEqual([]);
  });

  it("rechaza un fichero que no es un paquete", () => {
    expect(() => unpackAttachments(randomBytes(64))).toThrow(/no es una copia/);
  });

  it("rechaza un paquete cortado", () => {
    const paquete = packAttachments([item(500), item(500)]);
    expect(() => unpackAttachments(paquete.subarray(0, paquete.length - 10))).toThrow(/cortada/);
  });

  it("rechaza datos sobrantes y documentos repetidos", () => {
    const uno = item(50);
    const paquete = packAttachments([uno]);
    const conCola = new Uint8Array(paquete.length + 3);
    conCola.set(paquete);
    expect(() => unpackAttachments(conCola)).toThrow(/sobrantes/);
    expect(() => unpackAttachments(packAttachments([uno, uno]))).toThrow(/repite/);
  });

  it("una longitud declarada absurda no reserva memoria ni desborda", () => {
    const paquete = Uint8Array.from(packAttachments([item(20)]));
    // El campo de longitud del primer documento está tras magic(8)+count(4)+id(16).
    new DataView(paquete.buffer).setUint32(28, 0xffffffff);
    expect(() => unpackAttachments(paquete)).toThrow(/cortada/);
  });
});
