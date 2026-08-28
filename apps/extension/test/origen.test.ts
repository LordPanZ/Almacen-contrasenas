import { describe, expect, it } from "vitest";
import {
  decodificarHost,
  detectarEngano,
  detectarImitacion,
  esSubdominioDe,
  esSufijoPublico,
  esqueleto,
  evaluarOrigen,
  hostDe,
} from "../src/origen.ts";

const BANCO = "https://banco.es/login";

describe("coincidencia exacta de origen", () => {
  it("permite la misma dirección y el mismo host con otra ruta", () => {
    expect(evaluarOrigen(BANCO, "https://banco.es/login").permitido).toBe(true);
    expect(evaluarOrigen(BANCO, "https://banco.es/otra/ruta?x=1#y").permitido).toBe(true);
  });

  it("no distingue mayúsculas ni el punto final del nombre DNS", () => {
    // "banco.es." designa el mismo nombre: sin normalizar, burlaría la comparación.
    expect(evaluarOrigen(BANCO, "https://BANCO.ES/login").motivo).toBe("exacto");
    expect(evaluarOrigen(BANCO, "https://banco.es./login").motivo).toBe("exacto");
    expect(evaluarOrigen("https://BANCO.es.", "https://banco.es").motivo).toBe("exacto");
  });

  it("rechaza cualquier host distinto, por parecido que sea", () => {
    for (const impostor of [
      "https://banco.com/login",
      "https://banco.es.atacante.com/login",
      "https://bancoes.es/login",
      "https://banco-es.com/login",
      "https://mibanco.es/login",
      "https://banco.es.co/login",
    ]) {
      const veredicto = evaluarOrigen(BANCO, impostor);
      expect(veredicto.permitido).toBe(false);
      expect(veredicto.motivo).toBe("host-distinto");
    }
  });

  it("el sufijo del atacante no cuela como subdominio", () => {
    // "banco.es.atacante.com" TERMINA en algo que contiene "banco.es", pero no
    // es subdominio suyo: la comparación debe ser por límite de etiqueta.
    expect(esSubdominioDe("banco.es.atacante.com", "banco.es")).toBe(false);
    expect(esSubdominioDe("evilbanco.es", "banco.es")).toBe(false);
    expect(esSubdominioDe("cuentas.banco.es", "banco.es")).toBe(true);
  });
});

describe("página sin cifrar", () => {
  it("se niega a escribir en http", () => {
    const veredicto = evaluarOrigen("http://banco.es", "http://banco.es/login");
    expect(veredicto.permitido).toBe(false);
    expect(veredicto.motivo).toBe("sin-cifrado");
  });

  it("permite http solo en local, donde no hay red que espiar", () => {
    expect(evaluarOrigen("http://localhost:3000", "http://localhost:3000/entrar").permitido).toBe(true);
    expect(evaluarOrigen("http://127.0.0.1", "http://127.0.0.1/entrar").permitido).toBe(true);
  });
});

describe("subdominios", () => {
  it("solo se permiten si la entrada los autoriza", () => {
    const sinPermiso = evaluarOrigen(BANCO, "https://cuentas.banco.es/login");
    expect(sinPermiso.permitido).toBe(false);
    expect(sinPermiso.motivo).toBe("subdominio-no-autorizado");

    const conPermiso = evaluarOrigen(BANCO, "https://cuentas.banco.es/login", {
      permitirSubdominios: true,
    });
    expect(conPermiso.permitido).toBe(true);
    expect(conPermiso.motivo).toBe("subdominio");
  });

  it("nunca al revés: el dominio padre no hereda del subdominio", () => {
    const guardadaEnSubdominio = "https://cuentas.banco.es";
    expect(
      evaluarOrigen(guardadaEnSubdominio, "https://banco.es", { permitirSubdominios: true })
        .permitido,
    ).toBe(false);
  });

  it("un sufijo público no es dominio de nadie", () => {
    // Sin esta regla, guardar algo para "co.uk" convertiría a todo sitio
    // británico en subdominio autorizado.
    expect(esSufijoPublico("co.uk")).toBe(true);
    expect(esSufijoPublico("com")).toBe(true);
    expect(esSufijoPublico("github.io")).toBe(true);
    expect(esSufijoPublico("banco.es")).toBe(false);
    expect(esSubdominioDe("banco.co.uk", "co.uk")).toBe(false);
    expect(
      evaluarOrigen("https://co.uk", "https://banco.co.uk", { permitirSubdominios: true })
        .permitido,
    ).toBe(false);
  });
});

describe("marcos de otro origen", () => {
  it("nunca rellena dentro de un marco ajeno, aunque el host coincida", () => {
    // Una página cualquiera puede incrustar un formulario con aspecto de acceso.
    // Si la extensión mira solo el origen del marco, entrega la contraseña a
    // quien lo incrustó.
    const veredicto = evaluarOrigen(BANCO, "https://banco.es/login", { marcoAjeno: true });
    expect(veredicto.permitido).toBe(false);
    expect(veredicto.motivo).toBe("marco-ajeno");
  });
});

describe("entradas mal formadas", () => {
  it("no revienta y se niega", () => {
    for (const [guardada, actual] of [
      ["", "https://banco.es"],
      ["https://banco.es", ""],
      ["no-es-una-url", "https://banco.es"],
      ["https://banco.es", "javascript:alert(1)"],
    ] as const) {
      const veredicto = evaluarOrigen(guardada, actual);
      expect(veredicto.permitido).toBe(false);
    }
  });

  it("hostDe devuelve cadena vacía en vez de lanzar", () => {
    expect(hostDe("https://banco.es/x")).toBe("banco.es");
    expect(hostDe("basura")).toBe("");
  });
});

describe("dominios que imitan a otros", () => {
  it("descodifica punycode a los caracteres reales", () => {
    // «аpple.com» con la a cirílica.
    expect(decodificarHost("xn--pple-43d.com")).toBe("аpple.com");
    // Un dominio normal pasa intacto.
    expect(decodificarHost("banco.es")).toBe("banco.es");
    expect(decodificarHost("españa.es")).toBe("españa.es");
  });

  it("reduce a un mismo esqueleto los caracteres que se dibujan igual", () => {
    expect(esqueleto("xn--pple-43d.com")).toBe(esqueleto("apple.com"));
    expect(esqueleto("banco.es")).not.toBe(esqueleto("banca.es"));
  });

  it("avisa cuando la página imita a un sitio que tienes guardado", () => {
    const aviso = detectarImitacion("xn--pple-43d.com", ["apple.com", "banco.es"]);
    expect(aviso).not.toBeNull();
    expect(aviso?.hostImitado).toBe("apple.com");
    expect(aviso?.descodificado).toBe("аpple.com");
  });

  it("no avisa en el sitio auténtico ni en uno que no se parece a nada", () => {
    expect(detectarImitacion("apple.com", ["apple.com"])).toBeNull();
    expect(detectarImitacion("ejemplo-cualquiera.com", ["apple.com", "banco.es"])).toBeNull();
  });

  it("una etiqueta punycode inválida no rompe nada", () => {
    expect(() => decodificarHost("xn--")).not.toThrow();
    expect(() => decodificarHost("xn--!!!!.com")).not.toThrow();
    expect(() => esqueleto("xn--????.es")).not.toThrow();
  });
});

describe("dominios que cuelgan el tuyo como decoración", () => {
  it("detecta banco.es.atacante.com como suplantación", () => {
    const aviso = detectarEngano("banco.es.atacante.com", ["banco.es"]);
    expect(aviso?.hostSuplantado).toBe("banco.es");
  });

  it("detecta el dominio incrustado en medio", () => {
    expect(detectarEngano("login.banco.es.atacante.com", ["banco.es"])).not.toBeNull();
  });

  it("no confunde un subdominio legítimo con un engaño", () => {
    expect(detectarEngano("cuentas.banco.es", ["banco.es"])).toBeNull();
    expect(detectarEngano("banco.es", ["banco.es"])).toBeNull();
  });

  it("no avisa de dominios que no tienen nada que ver", () => {
    expect(detectarEngano("ejemplo.com", ["banco.es", "correo.example"])).toBeNull();
  });
});

describe("homógrafos reales", () => {
  it("reconoce banco.es escrito con la o cirílica", () => {
    // xn--banc-85d.es se lee «bancо.es»: idéntico a la vista, otro dominio.
    expect(decodificarHost("xn--banc-85d.es")).toBe("bancо.es");
    const aviso = detectarImitacion("xn--banc-85d.es", ["banco.es"]);
    expect(aviso?.hostImitado).toBe("banco.es");
  });

  it("reconoce la a cirílica", () => {
    expect(detectarImitacion("xn--bnco-53d.es", ["banco.es"])).not.toBeNull();
  });
});

describe("el veredicto siempre explica el porqué", () => {
  it("toda respuesta trae una explicación en lenguaje llano", () => {
    const casos = [
      evaluarOrigen(BANCO, "https://banco.es"),
      evaluarOrigen(BANCO, "https://otro.com"),
      evaluarOrigen(BANCO, "http://banco.es"),
      evaluarOrigen(BANCO, "https://sub.banco.es"),
      evaluarOrigen(BANCO, "https://banco.es", { marcoAjeno: true }),
    ];
    for (const veredicto of casos) {
      expect(veredicto.explicacion.length).toBeGreaterThan(20);
      // Sin esto el usuario concluye "la extensión falla" y teclea a mano,
      // que es justo lo que busca quien monta la página trampa.
      expect(veredicto.explicacion).toMatch(/[.!]$/);
    }
  });
});
