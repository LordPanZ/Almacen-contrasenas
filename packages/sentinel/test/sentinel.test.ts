import { describe, expect, it } from "vitest";
import { SecretBuffer, randomBytes, toHex, utf8Encode } from "@cerbero/crypto";
import {
  BreachClient,
  BreachOracle,
  BreachProofError,
  createCanary,
  createCanarySet,
  decoyQueries,
  estimateStrength,
  generateCanaryKey,
  generatePassphrase,
  generatePassword,
  isCanary,
  raiseCanaryAlarm,
  verifyCanary,
} from "../src/index.ts";

const claveBoveda = () => randomBytes(32);

describe("credenciales trampa", () => {
  it("un canario se reconoce con su clave y no con otra", () => {
    const clave = generateCanaryKey(claveBoveda());
    const otra = generateCanaryKey(claveBoveda());
    const canario = createCanary(clave);

    expect(isCanary(canario.secret, clave)).toBe(true);
    expect(isCanary(canario.secret, otra)).toBe(false);
    expect(verifyCanary(canario, clave)).toBe(true);
    expect(verifyCanary(canario, otra)).toBe(false);
  });

  it("las contraseñas reales no se confunden con canarios", () => {
    // La marca ocupa unos pocos bytes, así que hay una tasa de falsos positivos
    // inevitable; lo que no puede es ser apreciable.
    const clave = generateCanaryKey(claveBoveda());
    let falsosPositivos = 0;
    const intentos = 400;
    for (let i = 0; i < intentos; i++) {
      if (isCanary(generatePassword({ longitud: 20 }), clave)) falsosPositivos++;
    }
    expect(falsosPositivos / intentos).toBeLessThan(0.01);
  });

  it("un conjunto de canarios es variado y verosímil", () => {
    const clave = generateCanaryKey(claveBoveda());
    const conjunto = createCanarySet(clave, 12);

    expect(conjunto).toHaveLength(12);
    expect(new Set(conjunto.map((c) => c.id)).size).toBe(12);
    expect(new Set(conjunto.map((c) => c.secret)).size).toBe(12);
    for (const canario of conjunto) {
      expect(canario.servicio.length).toBeGreaterThan(0);
      // Vale tanto un correo como un alias corporativo del tipo "imoreno":
      // una bóveda real tiene de los dos, y forzar solo correos haría que los
      // señuelos destacaran justo por ser demasiado uniformes.
      expect(canario.usuario).toMatch(/^[\w.+-]+(@[\w.-]+)?$/);
      expect(canario.usuario.length).toBeGreaterThan(2);
      expect(isCanary(canario.secret, clave)).toBe(true);
    }
    // Servicios variados: no puede repetir siempre el mismo señuelo.
    expect(new Set(conjunto.map((c) => c.servicio)).size).toBeGreaterThan(1);
  });

  it("el disparo de un canario produce una alarma con severidad y contexto", () => {
    const clave = generateCanaryKey(claveBoveda());
    const canario = createCanary(clave, { servicio: "Nómina interna" });

    const alarma = raiseCanaryAlarm(canario, { origen: "uso", detalle: "intento de acceso web" });
    expect(alarma.canaryId).toBe(canario.id);
    expect(alarma.severidad).toBe("crítica");
    expect(alarma.mensaje).toMatch(/Nómina interna/);

    // Una lectura es menos grave que un uso: usarla es prueba de acceso real.
    expect(raiseCanaryAlarm(canario, { origen: "lectura" }).severidad).not.toBe("crítica");
  });

  it("la clave de canarios sale de la bóveda y es determinista", () => {
    const raiz = claveBoveda();
    expect(generateCanaryKey(raiz).bytes).toEqual(generateCanaryKey(raiz).bytes);
    expect(generateCanaryKey(raiz).bytes).not.toEqual(generateCanaryKey(claveBoveda()).bytes);
  });
});

describe("filtraciones con conocimiento cero", () => {
  const FILTRADAS = ["123456", "password", "qwerty", "verano2024", "iloveyou"];

  function servicio() {
    const oracle = BreachOracle.create();
    return { oracle, indice: oracle.indexBreachedPasswords(FILTRADAS) };
  }

  it("detecta las filtradas y no marca las que no lo están", () => {
    const { oracle, indice } = servicio();
    const cliente = new BreachClient();

    for (const filtrada of FILTRADAS) {
      const preparada = cliente.prepare(filtrada);
      const resultado = cliente.finish(
        preparada,
        oracle.blindEvaluate(preparada.query),
        oracle.publicKey,
        indice,
      );
      expect(resultado.filtrada).toBe(true);
    }

    for (const limpia of ["8f3a-cierva-cobalto-remo", "una-que-nadie-ha-usado-jamas"]) {
      const preparada = cliente.prepare(limpia);
      const resultado = cliente.finish(
        preparada,
        oracle.blindEvaluate(preparada.query),
        oracle.publicKey,
        indice,
      );
      expect(resultado.filtrada).toBe(false);
    }
  });

  it("el servidor no puede correlacionar dos consultas de la misma contraseña", () => {
    const cliente = new BreachClient();
    const cegados = new Set<string>();
    for (let i = 0; i < 20; i++) {
      cegados.add(toHex(cliente.prepare("la misma contraseña").query.blinded));
    }
    expect(cegados.size).toBe(20);
  });

  it("lo que sale al servidor no contiene la contraseña ni su hash", () => {
    const cliente = new BreachClient();
    const password = "contraseña-muy-reconocible-9f3a";
    const enviado = toHex(cliente.prepare(password).query.blinded);
    expect(enviado).not.toContain(toHex(utf8Encode(password)));
    // Solo viaja el punto cegado: nada de longitudes ni prefijos.
    expect(cliente.prepare(password).query.blinded.length).toBe(32);
    expect(cliente.prepare("x").query.blinded.length).toBe(32);
  });

  it("el veredicto es estable para la misma contraseña y clave", () => {
    const { oracle, indice } = servicio();
    const cliente = new BreachClient();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const preparada = cliente.prepare("password");
      ids.add(
        cliente.finish(preparada, oracle.blindEvaluate(preparada.query), oracle.publicKey, indice)
          .identificador,
      );
    }
    expect(ids.size).toBe(1);
  });

  it("el índice de un servidor no sirve con la clave de otro", () => {
    const primero = servicio();
    const segundo = servicio();
    const cliente = new BreachClient();

    const preparada = cliente.prepare("password");
    const resultado = cliente.finish(
      preparada,
      segundo.oracle.blindEvaluate(preparada.query),
      segundo.oracle.publicKey,
      primero.indice,
    );
    expect(resultado.filtrada).toBe(false);
  });

  it("rechaza una respuesta que no demuestra haber usado la clave anunciada", () => {
    const { oracle, indice } = servicio();
    const impostor = BreachOracle.create();
    const cliente = new BreachClient();
    const preparada = cliente.prepare("password");

    // Un servidor que responde con otra clave pero afirma ser el legítimo.
    expect(() =>
      cliente.finish(preparada, impostor.blindEvaluate(preparada.query), oracle.publicKey, indice),
    ).toThrow(BreachProofError);

    // Y una prueba manipulada tampoco cuela.
    const respuesta = oracle.blindEvaluate(preparada.query);
    const falsa = { evaluated: respuesta.evaluated, proof: Uint8Array.from(respuesta.proof) };
    (falsa.proof[0] as number) !== undefined && (falsa.proof[0] ^= 0x01);
    expect(() => cliente.finish(preparada, falsa, oracle.publicKey, indice)).toThrow(
      BreachProofError,
    );
  });

  it("la misma semilla reconstruye el mismo servicio", () => {
    const semilla = randomBytes(32);
    const a = BreachOracle.fromSeed(semilla);
    const b = BreachOracle.fromSeed(semilla);
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.indexBreachedPasswords(FILTRADAS).identifiers).toEqual(
      b.indexBreachedPasswords(FILTRADAS).identifiers,
    );
  });

  it("acepta contraseñas en SecretBuffer, no solo cadenas", () => {
    const { oracle, indice } = servicio();
    const cliente = new BreachClient();
    const secreta = SecretBuffer.fromText("password");
    const preparada = cliente.prepare(secreta);
    secreta.destroy();
    expect(
      cliente.finish(preparada, oracle.blindEvaluate(preparada.query), oracle.publicKey, indice)
        .filtrada,
    ).toBe(true);
  });

  it("las consultas señuelo son indistinguibles de las reales", () => {
    const senuelos = decoyQueries(5);
    expect(senuelos).toHaveLength(5);
    for (const senuelo of senuelos) expect(senuelo.query.blinded.length).toBe(32);
    expect(new Set(senuelos.map((s) => toHex(s.query.blinded))).size).toBe(5);
  });
});

describe("generación de contraseñas", () => {
  it("respeta la longitud pedida y no repite salidas", () => {
    const generadas = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const password = generatePassword({ longitud: 24 });
      expect(password).toHaveLength(24);
      generadas.add(password);
    }
    expect(generadas.size).toBe(200);
  });

  it("cumple las clases de caracteres solicitadas", () => {
    for (let i = 0; i < 50; i++) {
      const password = generatePassword({
        longitud: 16,
        minusculas: true,
        mayusculas: true,
        digitos: true,
        simbolos: true,
      });
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^a-zA-Z0-9]/);
    }
  });

  it("puede excluir caracteres ambiguos", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePassword({ longitud: 30, excluirAmbiguos: true })).not.toMatch(/[O0lI1]/);
    }
  });

  it("las frases de contraseña tienen el número de palabras pedido", () => {
    const frase = generatePassphrase({ palabras: 6, separador: "-" });
    expect(frase.split("-")).toHaveLength(6);
    expect(generatePassphrase({ palabras: 6 })).not.toBe(generatePassphrase({ palabras: 6 }));
  });

  it("no introduce sesgo apreciable en la distribución de caracteres", () => {
    // Un generador que "arregla" la contraseña sustituyendo posiciones fijas
    // deja huella estadística; este baraja, así que no debería haberla.
    const cuentas = new Map<string, number>();
    for (let i = 0; i < 500; i++) {
      for (const caracter of generatePassword({ longitud: 20, simbolos: false })) {
        cuentas.set(caracter, (cuentas.get(caracter) ?? 0) + 1);
      }
    }
    const valores = [...cuentas.values()];
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    // Ningún carácter debería aparecer más del triple de la media.
    expect(Math.max(...valores)).toBeLessThan(media * 3);
  });
});

describe("evaluación de fortaleza", () => {
  it("puntúa alto una contraseña larga y aleatoria", () => {
    const informe = estimateStrength(generatePassword({ longitud: 24, simbolos: true }));
    expect(informe.bits).toBeGreaterThan(100);
    expect(["fuerte", "excelente"]).toContain(informe.veredicto);
  });

  it("puntúa bajo y avisa sobre las contraseñas típicas", () => {
    for (const mala of ["Password123", "aaaaaaa", "qwerty", "123456"]) {
      const informe = estimateStrength(mala);
      expect(["muy débil", "débil"]).toContain(informe.veredicto);
      expect(informe.avisos.length).toBeGreaterThan(0);
    }
  });

  it("da consejos accionables cuando la contraseña es floja", () => {
    const informe = estimateStrength("verano2024");
    expect(informe.consejos.length).toBeGreaterThan(0);
    expect(informe.consejos.join(" ")).toMatch(/\w+/);
  });

  it("una frase larga puntúa mejor que una contraseña corta con símbolos", () => {
    const frase = estimateStrength(generatePassphrase({ palabras: 7 }));
    const corta = estimateStrength("A1!bC2@");
    expect(frase.bits).toBeGreaterThan(corta.bits);
  });
});
