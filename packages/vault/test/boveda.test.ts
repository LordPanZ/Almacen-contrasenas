import { describe, expect, it } from "vitest";
import { SecretBuffer, toHex, utf8Encode } from "@cerbero/crypto";
import {
  DEFAULT_SLOT_COUNT,
  UnlockedVault,
  VaultError,
  VaultFullError,
  VaultLockedError,
  VAULT_HEADER_LENGTH,
  VaultUnlockError,
  addVaultSlot,
  createVault,
  unlockVault,
  vaultFileInfo,
  verifyVaultPassword,
  type VaultItemDraft,
} from "../src/index.ts";

const PERFIL = "test" as const;

/** Bytes crudos de una ranura, para comparar que un guardado no la ha tocado. */
function trozoDeRanura(fichero: Uint8Array, ranura: number): string {
  const tamano = vaultFileInfo(fichero).slotSize;
  const inicio = VAULT_HEADER_LENGTH + ranura * tamano;
  return toHex(fichero.subarray(inicio, inicio + tamano));
}

function contrasena(texto: string): SecretBuffer {
  return SecretBuffer.fromText(texto);
}

function nuevaBoveda(opciones: { items?: readonly VaultItemDraft[]; slotSize?: number } = {}) {
  return createVault(contrasena("frase maestra de la bóveda real"), {
    argon2Profile: PERFIL,
    ...opciones,
  });
}

const ENTRADA_BANCO: VaultItemDraft = {
  type: "login",
  title: "Banco Santander",
  username: "urko@ejemplo.es",
  secret: "contraseña-del-banco-9f3a",
  url: "https://particulares.bancosantander.es",
  notes: "Tarjeta de coordenadas en el cajón",
  tags: ["finanzas", "crítico"],
};

describe("ciclo de vida de la bóveda", () => {
  it("crea, guarda y vuelve a abrir con los mismos ítems", () => {
    const { file, vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    const guardado = vault.serialize();
    vault.lock();

    const reabierta = unlockVault(guardado, contrasena("frase maestra de la bóveda real"));
    expect(reabierta.size).toBe(1);
    const item = reabierta.find("santander")[0];
    expect(item?.title).toBe("Banco Santander");
    expect(item?.secret).toBe("contraseña-del-banco-9f3a");
    expect(item?.tags).toEqual(["finanzas", "crítico"]);
    expect(file.length).toBe(guardado.length);
  });

  it("añade, actualiza y borra entradas", () => {
    const { vault } = nuevaBoveda();
    const item = vault.add(ENTRADA_BANCO);
    expect(vault.size).toBe(1);

    const actualizado = vault.update(item.id, { secret: "nueva-contraseña", title: "Banco (nuevo)" });
    expect(actualizado.title).toBe("Banco (nuevo)");
    expect(actualizado.secret).toBe("nueva-contraseña");
    expect(actualizado.createdAt).toBe(item.createdAt);

    expect(vault.remove(item.id)).toBe(true);
    expect(vault.remove(item.id)).toBe(false);
    expect(vault.size).toBe(0);
  });

  it("busca por título, usuario, dirección, notas y etiquetas", () => {
    const { vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    for (const consulta of ["santander", "urko@", "bancosantander.es", "coordenadas", "finanzas"]) {
      expect(vault.find(consulta)).toHaveLength(1);
    }
    expect(vault.find("no-existe-esto")).toHaveLength(0);
  });

  it("rechaza actualizar un ítem inexistente y títulos vacíos", () => {
    const { vault } = nuevaBoveda();
    expect(() => vault.update("00".repeat(16), { title: "x" })).toThrow(VaultError);
    expect(() => vault.add({ ...ENTRADA_BANCO, title: "   " })).toThrow(VaultError);
  });

  it("lock borra las claves y todo uso posterior falla", () => {
    const { vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    vault.lock();
    expect(vault.locked).toBe(true);
    expect(() => vault.add(ENTRADA_BANCO)).toThrow(VaultLockedError);
    expect(() => vault.serialize()).toThrow(VaultLockedError);
    expect(() => vault.get("x")).toThrow(VaultLockedError);
  });

  it("las claves de identidad son deterministas para la misma bóveda", () => {
    const { vault } = nuevaBoveda();
    const guardado = vault.serialize();
    const primera = vault.identityKeyPair().publicKey;
    const firma = vault.signingKeyPair().publicKey;
    vault.lock();

    const reabierta = unlockVault(guardado, contrasena("frase maestra de la bóveda real"));
    expect(reabierta.identityKeyPair().publicKey).toEqual(primera);
    expect(reabierta.signingKeyPair().publicKey).toEqual(firma);
  });
});

describe("contraseña incorrecta", () => {
  it("falla al abrir y verifyVaultPassword lo refleja", () => {
    const { file } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    expect(() => unlockVault(file, contrasena("no es la contraseña"))).toThrow(VaultUnlockError);
    expect(verifyVaultPassword(file, contrasena("no es la contraseña"))).toBe(false);
    expect(verifyVaultPassword(file, contrasena("frase maestra de la bóveda real"))).toBe(true);
  });

  it("una contraseña incorrecta falla igual que una ranura vacía", () => {
    // Fichero con UNA bóveda: tres de sus cuatro ranuras son ruido. Fallar
    // contra ruido y fallar contra una ranura ajena deben ser indistinguibles.
    const { file } = nuevaBoveda();
    const mensajes = new Set<string>();
    for (const intento of ["mala-1", "mala-2", "mala-3", "mala-4", "mala-5"]) {
      try {
        unlockVault(file, contrasena(intento));
      } catch (error) {
        mensajes.add((error as Error).message);
      }
    }
    expect(mensajes.size).toBe(1);
  });

  it("alterar la cabecera impide abrir cualquier bóveda del fichero", () => {
    // La cabecera entra en el `aad` de todas las ranuras, así que tocarla
    // invalida el fichero entero: no se puede trasplantar una ranura a otro
    // fichero con otra sal ni cambiarle los parámetros de Argon2.
    const { file } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    for (const posicion of [0, 10, 20, VAULT_HEADER_LENGTH - 1]) {
      const alterado = Uint8Array.from(file);
      alterado[posicion] ^= 0x01;
      expect(() => unlockVault(alterado, contrasena("frase maestra de la bóveda real"))).toThrow();
    }
  });

  it("alterar un byte de tu propia ranura impide abrirla", () => {
    const { file, vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    const guardado = vault.serialize();
    const { slotSize } = vaultFileInfo(guardado);
    const inicio = VAULT_HEADER_LENGTH + vault.slot * slotSize;
    vault.lock();

    for (const desplazamiento of [0, 100, slotSize - 1]) {
      const alterado = Uint8Array.from(guardado);
      (alterado[inicio + desplazamiento] as number) ^= 0x01;
      expect(() => unlockVault(alterado, contrasena("frase maestra de la bóveda real"))).toThrow(
        VaultUnlockError,
      );
    }
    expect(file.length).toBe(guardado.length);
  });

  it("alterar OTRA ranura no afecta a la tuya, y eso es intencionado", () => {
    // Las ranuras son criptográficamente independientes. Que corromper un
    // señuelo no arrastre tu bóveda real es la otra cara de la negación
    // plausible: cada una vive y muere por su cuenta.
    const { vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    const guardado = vault.serialize();
    const { slotSize, slotCount } = vaultFileInfo(guardado);
    const propia = vault.slot;
    vault.lock();

    const ajena = (propia + 1) % slotCount;
    const alterado = Uint8Array.from(guardado);
    (alterado[VAULT_HEADER_LENGTH + ajena * slotSize + 50] as number) ^= 0xff;

    const reabierta = unlockVault(alterado, contrasena("frase maestra de la bóveda real"));
    expect(reabierta.find("santander")).toHaveLength(1);
  });
});

describe("bóveda de coacción y negación plausible", () => {
  const REAL = "frase maestra de la bóveda real";
  const COACCION = "esta es la que doy si me obligan";

  function ficheroConDosBovedas() {
    const { vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    const conUna = vault.serialize();
    vault.lock();
    const conDos = addVaultSlot(conUna, {
      existingPassword: contrasena(REAL),
      newPassword: contrasena(COACCION),
      items: [
        { type: "login", title: "Correo personal", username: "yo@ejemplo.es", secret: "algo-creible" },
      ],
    });
    return { conUna, conDos };
  }

  it("cada contraseña abre una bóveda distinta e independiente", () => {
    const { conDos } = ficheroConDosBovedas();

    const real = unlockVault(conDos, contrasena(REAL));
    const senuelo = unlockVault(conDos, contrasena(COACCION));

    expect(real.find("santander")).toHaveLength(1);
    expect(real.find("Correo personal")).toHaveLength(0);
    expect(senuelo.find("Correo personal")).toHaveLength(1);
    expect(senuelo.find("santander")).toHaveLength(0);
    expect(real.vaultId).not.toBe(senuelo.vaultId);
    expect(real.slot).not.toBe(senuelo.slot);
  });

  it("añadir una bóveda no cambia el tamaño ni la cabecera del fichero", () => {
    const { conUna, conDos } = ficheroConDosBovedas();
    expect(conDos.length).toBe(conUna.length);

    const antes = vaultFileInfo(conUna);
    const despues = vaultFileInfo(conDos);
    expect(despues.slotCount).toBe(antes.slotCount);
    expect(despues.slotSize).toBe(antes.slotSize);
    expect(despues.salt).toEqual(antes.salt);
    // La cabecera entera es idéntica: nada en lo público dice cuántas bóvedas hay.
    const cabecera = (f: Uint8Array) => toHex(f.subarray(0, VAULT_HEADER_LENGTH));
    expect(cabecera(conDos)).toBe(cabecera(conUna));
  });

  it("escribir en una bóveda deja las demás ranuras byte a byte idénticas", () => {
    const { conDos } = ficheroConDosBovedas();
    const real = unlockVault(conDos, contrasena(REAL));
    real.add({ type: "note", title: "Nota nueva", notes: "algo" });
    const despues = real.serialize();

    // La bóveda de coacción sigue abriéndose y con su contenido intacto.
    const senuelo = unlockVault(despues, contrasena(COACCION));
    expect(senuelo.find("Correo personal")).toHaveLength(1);
    expect(senuelo.size).toBe(1);

    // Y sus bytes no se han tocado.
    const tamanoRanura = vaultFileInfo(despues).slotSize;
    const inicio = VAULT_HEADER_LENGTH + senuelo.slot * tamanoRanura;
    expect(toHex(despues.subarray(inicio, inicio + tamanoRanura))).toBe(
      toHex(conDos.subarray(inicio, inicio + tamanoRanura)),
    );
  });

  it("no deja reutilizar una contraseña que ya abre una ranura", () => {
    const { conUna } = ficheroConDosBovedas();
    expect(() =>
      addVaultSlot(conUna, {
        existingPassword: contrasena(REAL),
        newPassword: contrasena(REAL),
      }),
    ).toThrow(/ya abre una bóveda/);
  });

  it("declarar las bóvedas anteriores evita pisarlas al llenar el fichero", () => {
    // Cerbero no puede detectar por su cuenta qué ranuras están ocupadas: esa
    // imposibilidad es lo que hace negable el fichero. Con las contraseñas que
    // le aportas sí puede, y debe respetarlas todas.
    const { conUna } = ficheroConDosBovedas();
    const claves = [REAL];
    let fichero = conUna;

    for (const nueva of ["segunda", "tercera", "cuarta"]) {
      fichero = addVaultSlot(fichero, {
        existingPassword: contrasena(REAL),
        otherPasswords: claves.slice(1).map(contrasena),
        newPassword: contrasena(nueva),
      });
      claves.push(nueva);
      // Ninguna de las anteriores se ha perdido por el camino.
      for (const clave of claves) {
        expect(verifyVaultPassword(fichero, contrasena(clave))).toBe(true);
      }
    }

    // Con las cuatro ranuras declaradas no queda hueco, y hay que decirlo
    // claramente en vez de sobrescribir una bóveda en silencio.
    expect(() =>
      addVaultSlot(fichero, {
        existingPassword: contrasena(REAL),
        otherPasswords: claves.slice(1).map(contrasena),
        newPassword: contrasena("quinta"),
      }),
    ).toThrow(/ranura libre/);
  });

  it("rechaza escribir en una ranura declarada como ocupada", () => {
    const { conUna } = ficheroConDosBovedas();
    const actual = unlockVault(conUna, contrasena(REAL));
    const suya = actual.slot;
    actual.lock();
    expect(() =>
      addVaultSlot(conUna, {
        existingPassword: contrasena(REAL),
        newPassword: contrasena(COACCION),
        slot: suya,
      }),
    ).toThrow(/ocupa/);
  });

  it("la primera bóveda no cae siempre en la misma ranura", () => {
    // Si cayera siempre en la 0, quien te coaccionara y viera que la suya es
    // la 2 sabría que existe otra bóveda: el índice delataría el secreto.
    const ranuras = new Set<number>();
    for (let i = 0; i < 25; i++) {
      const { vault } = nuevaBoveda();
      ranuras.add(vault.slot);
      vault.lock();
    }
    expect(ranuras.size).toBeGreaterThan(1);
  });

  it("un fichero con una bóveda y otro con tres son indistinguibles en lo público", () => {
    const { vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    let conTres = vault.serialize();
    vault.lock();
    conTres = addVaultSlot(conTres, {
      existingPassword: contrasena(REAL),
      newPassword: contrasena("segunda"),
    });
    conTres = addVaultSlot(conTres, {
      existingPassword: contrasena(REAL),
      // Sin declarar la segunda, la elección al azar podría pisarla.
      otherPasswords: [contrasena("segunda")],
      newPassword: contrasena("tercera"),
    });

    const { vault: otra } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    const conUna = otra.serialize();
    otra.lock();

    expect(conTres.length).toBe(conUna.length);
    expect(vaultFileInfo(conTres).slotCount).toBe(vaultFileInfo(conUna).slotCount);
    // Las tres se abren, cada una con su contraseña.
    for (const clave of [REAL, "segunda", "tercera"]) {
      expect(verifyVaultPassword(conTres, contrasena(clave))).toBe(true);
    }
  });
});

describe("metadatos y tamaños ocultos", () => {
  it("ni el título, ni la dirección, ni el usuario aparecen en el fichero", () => {
    const { vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    const file = vault.serialize();
    const bytes = toHex(file);

    for (const secreto of [
      "Banco Santander",
      "urko@ejemplo.es",
      "particulares.bancosantander.es",
      "contraseña-del-banco-9f3a",
      "finanzas",
    ]) {
      expect(bytes).not.toContain(toHex(utf8Encode(secreto)));
    }
  });

  it("el fichero no revela cuántos ítems hay: su tamaño no depende del contenido", () => {
    const uno = nuevaBoveda({ items: [ENTRADA_BANCO] });
    const muchos = nuevaBoveda({
      items: Array.from({ length: 40 }, (_, i) => ({
        type: "login" as const,
        title: `Servicio ${i}`,
        secret: `clave-${i}`,
      })),
    });
    expect(muchos.file.length).toBe(uno.file.length);
    expect(muchos.vault.serialize().length).toBe(uno.vault.serialize().length);
  });

  it("una entrada corta y una larga ocupan lo mismo gracias al relleno por cubos", () => {
    const { vault } = nuevaBoveda();
    const corta = vault.add({ type: "note", title: "a", notes: "b" });
    const usadoTrasCorta = vault.usedBytes;
    vault.remove(corta.id);

    vault.add({ type: "note", title: "a", notes: "b".repeat(100) });
    expect(vault.usedBytes).toBe(usadoTrasCorta);
  });

  it("una nota muy larga sí salta al cubo siguiente", () => {
    const { vault } = nuevaBoveda();
    const pequena = vault.add({ type: "note", title: "n", notes: "x" });
    const usadoPequena = vault.usedBytes;
    vault.remove(pequena.id);
    vault.add({ type: "note", title: "n", notes: "x".repeat(5000) });
    expect(vault.usedBytes).toBeGreaterThan(usadoPequena);
  });
});

describe("anexos de la bóveda", () => {
  it("guarda y recupera bloques opacos por clave", () => {
    const { vault } = nuevaBoveda();
    vault.setExtra("recovery", new Uint8Array([1, 2, 3, 4]));
    vault.setExtra("ledger", new Uint8Array([9, 9]));
    expect(vault.getExtra("recovery")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(vault.extraKeys().sort()).toEqual(["ledger", "recovery"]);
    expect(vault.getExtra("no-existe")).toBeNull();
  });

  it("los anexos sobreviven a guardar y reabrir", () => {
    const { vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    vault.setExtra("recovery", utf8Encode("política de guardianes"));
    const guardado = vault.serialize();
    vault.lock();

    const reabierta = unlockVault(guardado, contrasena("frase maestra de la bóveda real"));
    expect(reabierta.getExtra("recovery")).toEqual(utf8Encode("política de guardianes"));
    expect(reabierta.size).toBe(1);
  });

  it("auditLog es un atajo sobre los anexos, no un campo aparte", () => {
    const { vault } = nuevaBoveda();
    vault.auditLog = new Uint8Array([7, 7, 7]);
    expect(vault.getExtra("ledger")).toEqual(new Uint8Array([7, 7, 7]));
    vault.setExtra("ledger", new Uint8Array([1]));
    expect(vault.auditLog).toEqual(new Uint8Array([1]));
  });

  it("el contenido de un anexo no aparece en claro en el fichero", () => {
    const { vault } = nuevaBoveda();
    vault.setExtra("recovery", utf8Encode("fragmento-secretísimo-de-guardián"));
    const file = vault.serialize();
    expect(toHex(file)).not.toContain(toHex(utf8Encode("fragmento-secretísimo-de-guardián")));
  });

  it("guardar NO destruye los anexos que siguen en memoria", () => {
    // Regresión: al empaquetar la ranura, los valores de los anexos entraban en
    // la lista de trozos que se borra al terminar. El fichero salía correcto,
    // pero la sesión viva se quedaba con los anexos a ceros, así que la
    // siguiente lectura fallaba al interpretarlos.
    const { vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    const original = Uint8Array.from([5, 1, 0, 42, 99, 7]);
    vault.setExtra("deadman", original);
    vault.auditLog = utf8Encode("registro");

    vault.serialize();

    expect(vault.getExtra("deadman")).toEqual(original);
    expect(vault.auditLog).toEqual(utf8Encode("registro"));

    // Y sigue siendo cierto tras guardar varias veces seguidas.
    vault.serialize();
    vault.serialize();
    expect(vault.getExtra("deadman")).toEqual(original);
  });

  it("los ítems descifrados sobreviven a guardar", () => {
    const { vault } = nuevaBoveda({ items: [ENTRADA_BANCO] });
    vault.serialize();
    vault.serialize();
    expect(vault.find("santander")[0]?.secret).toBe("contraseña-del-banco-9f3a");
  });

  it("un anexo que no cabe falla sin destruir el anterior", () => {
    const { vault } = nuevaBoveda({ slotSize: 4096 });
    vault.setExtra("recovery", new Uint8Array(100).fill(3));
    expect(() => vault.setExtra("recovery", new Uint8Array(64 * 1024))).toThrow(VaultFullError);
    // El valor previo sigue intacto: fallar no puede costarte lo que ya tenías.
    expect(vault.getExtra("recovery")).toEqual(new Uint8Array(100).fill(3));
  });

  it("rechaza claves de anexo vacías o desmedidas", () => {
    const { vault } = nuevaBoveda();
    expect(() => vault.setExtra("", new Uint8Array(1))).toThrow(VaultError);
    expect(() => vault.setExtra("k".repeat(300), new Uint8Array(1))).toThrow(VaultError);
  });

  it("dos bóvedas con los mismos anexos los serializan igual, sea cual sea el orden", () => {
    // Sin orden estable, el criptograma dependería de en qué orden los escribió
    // el programa, y eso filtraría el orden de las operaciones del usuario.
    const uno = nuevaBoveda();
    uno.vault.setExtra("bbb", new Uint8Array([2]));
    uno.vault.setExtra("aaa", new Uint8Array([1]));
    const otro = nuevaBoveda();
    otro.vault.setExtra("aaa", new Uint8Array([1]));
    otro.vault.setExtra("bbb", new Uint8Array([2]));
    expect(uno.vault.usedBytes).toBe(otro.vault.usedBytes);
    expect(uno.vault.extraKeys().sort()).toEqual(otro.vault.extraKeys().sort());
  });
});

describe("capacidad de la ranura", () => {
  it("avisa claramente cuando la bóveda se llena y no pierde el estado anterior", () => {
    const { vault } = nuevaBoveda({ slotSize: 4096 });
    const relleno = { type: "note" as const, title: "relleno", notes: "y".repeat(900) };

    let anadidos = 0;
    let error: unknown = null;
    for (let i = 0; i < 50; i++) {
      try {
        vault.add({ ...relleno, title: `relleno ${i}` });
        anadidos++;
      } catch (e) {
        error = e;
        break;
      }
    }
    expect(error).toBeInstanceOf(VaultFullError);
    expect((error as Error).message).toMatch(/llena/);
    // El ítem que no cabía se revirtió: lo anterior sigue siendo guardable.
    expect(vault.size).toBe(anadidos);
    expect(() => vault.serialize()).not.toThrow();
  });

  it("rechaza geometrías absurdas al crear", () => {
    const clave = () => contrasena("x");
    expect(() => createVault(clave(), { argon2Profile: PERFIL, slotCount: 1 })).toThrow(VaultError);
    expect(() => createVault(clave(), { argon2Profile: PERFIL, slotSize: 16 })).toThrow(VaultError);
  });

  it("respeta el número de ranuras solicitado", () => {
    const { file, vault } = createVault(contrasena("x"), {
      argon2Profile: PERFIL,
      slotCount: 8,
      slotSize: 2048,
    });
    expect(vaultFileInfo(file).slotCount).toBe(8);
    expect(vault.slotCount).toBe(8);
    expect(vault.slot).toBeLessThan(8);
    expect(vaultFileInfo(file).slotCount).not.toBe(DEFAULT_SLOT_COUNT);
  });
});

describe("superficie de la clase", () => {
  it("UnlockedVault no se puede construir desde fuera con `new`", () => {
    // El constructor es privado: solo createVault y unlockVault producen bóvedas,
    // así que no hay forma de fabricar una con un sobre inventado.
    expect(typeof UnlockedVault).toBe("function");
    expect(() => (UnlockedVault as unknown as new () => unknown)()).toThrow();
  });
});

describe("factor de hardware", () => {
  const clave = () => SecretBuffer.fromText("correcto caballo grapa");
  const FACTOR = new Uint8Array(32).fill(0xa1);
  const OTRO = new Uint8Array(32).fill(0xb2);

  it("la contraseña sola no abre una bóveda vinculada a una llave", () => {
    const { file } = createVault(clave(), { argon2Profile: "test", hardwareFactor: FACTOR });
    expect(() => unlockVault(file, clave())).toThrow(VaultUnlockError);
  });

  it("abre con la contraseña y el factor correctos", () => {
    const { file } = createVault(clave(), {
      argon2Profile: "test",
      hardwareFactor: FACTOR,
      items: [{ type: "login", title: "Netflix", secret: "s3cr3to" }],
    });
    const abierta = unlockVault(file, clave(), { hardwareFactor: FACTOR });
    expect(abierta.list()).toHaveLength(1);
    abierta.lock();
  });

  it("otro factor no abre, aunque la contraseña sea la buena", () => {
    const { file } = createVault(clave(), { argon2Profile: "test", hardwareFactor: FACTOR });
    expect(() => unlockVault(file, clave(), { hardwareFactor: OTRO })).toThrow(VaultUnlockError);
  });

  it("el fichero no delata que haya una llave de por medio", () => {
    // Mismos parámetros y misma geometría: lo público debe ser indistinguible.
    const con = createVault(clave(), { argon2Profile: "test", hardwareFactor: FACTOR }).file;
    const sin = createVault(clave(), { argon2Profile: "test" }).file;
    expect(con.length).toBe(sin.length);
    const publicoCon = vaultFileInfo(con);
    const publicoSin = vaultFileInfo(sin);
    expect(publicoCon.slotCount).toBe(publicoSin.slotCount);
    expect(publicoCon.slotSize).toBe(publicoSin.slotSize);
    expect(publicoCon.argon2).toEqual(publicoSin.argon2);
  });

  it("vincular una llave a una bóveda existente conserva las entradas", () => {
    const { file } = createVault(clave(), {
      argon2Profile: "test",
      items: [{ type: "login", title: "Netflix", secret: "s3cr3to" }],
    });
    const abierta = unlockVault(file, clave());
    const vinculado = abierta.rebind(clave(), null, FACTOR);
    abierta.lock();

    expect(() => unlockVault(vinculado, clave())).toThrow(VaultUnlockError);
    const conLlave = unlockVault(vinculado, clave(), { hardwareFactor: FACTOR });
    const item = conLlave.get(conLlave.list()[0]!.id);
    expect(item?.secret).toBe("s3cr3to");
    conLlave.lock();
  });

  it("desvincular la llave devuelve la bóveda a contraseña sola", () => {
    const { file } = createVault(clave(), { argon2Profile: "test", hardwareFactor: FACTOR });
    const abierta = unlockVault(file, clave(), { hardwareFactor: FACTOR });
    const suelto = abierta.rebind(clave(), FACTOR, null);
    abierta.lock();
    const sinLlave = unlockVault(suelto, clave());
    expect(sinLlave.size).toBe(0);
    sinLlave.lock();
  });

  it("rebind con la contraseña equivocada no toca nada, en vez de dejarte fuera", () => {
    const { file } = createVault(clave(), {
      argon2Profile: "test",
      items: [{ type: "login", title: "Netflix", secret: "s3cr3to" }],
    });
    const abierta = unlockVault(file, clave());
    expect(() => abierta.rebind(SecretBuffer.fromText("me equivoqué"), null, FACTOR)).toThrow(
      /no se ha cambiado nada/,
    );
    // La bóveda sigue abriéndose como antes: el fallo no dejó rastro.
    const intacto = abierta.serialize();
    abierta.lock();
    const despues = unlockVault(intacto, clave());
    expect(despues.list()).toHaveLength(1);
    despues.lock();
  });

  it("rebind con el factor actual equivocado tampoco toca nada", () => {
    const { file } = createVault(clave(), { argon2Profile: "test", hardwareFactor: FACTOR });
    const abierta = unlockVault(file, clave(), { hardwareFactor: FACTOR });
    expect(() => abierta.rebind(clave(), OTRO, null)).toThrow(/no se ha cambiado nada/);
    abierta.lock();
  });

  it("vincular una llave deja las demás ranuras byte a byte idénticas", () => {
    const otraClave = SecretBuffer.fromText("la segunda bóveda del fichero");
    const { file } = createVault(clave(), { argon2Profile: "test" });
    const conDos = addVaultSlot(file, {
      existingPassword: clave(),
      newPassword: otraClave.clone(),
      items: [{ type: "note", title: "coartada" }],
    });

    const primera = unlockVault(conDos, clave());
    const ranuraDeLaOtra = unlockVault(conDos, otraClave.clone()).slot;
    const antes = trozoDeRanura(conDos, ranuraDeLaOtra);
    const vinculado = primera.rebind(clave(), null, FACTOR);
    primera.lock();

    expect(trozoDeRanura(vinculado, ranuraDeLaOtra)).toEqual(antes);
    // Y la otra bóveda sigue abriéndose con su contraseña, sin llave.
    const otra = unlockVault(vinculado, otraClave.clone());
    expect(otra.list()).toHaveLength(1);
    otra.lock();
  });
});
