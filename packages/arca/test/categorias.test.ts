import { describe, expect, it } from "vitest";
import { SecretBuffer, toHex } from "@cerbero/crypto";
import {
  CATEGORIAS_BASE,
  CajaFormatoError,
  CategoriaError,
  MAX_CATEGORIAS,
  MAX_NOMBRE_CATEGORIA,
  conCategoriaNueva,
  conCategoriaRenombrada,
  crearCaja,
  existeCategoria,
  indiceVacio,
  leerIndice,
  normalizarNombreCategoria,
  nuevoIdDocumento,
  sinCategoria,
  type DocumentoMeta,
  type Indice,
} from "../src/index.ts";

const doc = (categoria: string, n = 0): DocumentoMeta => ({
  id: nuevoIdDocumento(),
  nombre: `documento-${n}.pdf`,
  mime: "application/pdf",
  tam: 100 + n,
  categoria,
  notas: "",
  creado: 1,
  actualizado: 2,
});

const conDocs = (...categorias: string[]): Indice => ({
  ...indiceVacio(),
  documentos: categorias.map((c, i) => doc(c, i)),
});

describe("carpetas: lo que trae una caja y cómo se lee el índice antiguo", () => {
  it("una caja nueva trae las nueve carpetas de siempre, con los identificadores de siempre", () => {
    const i = indiceVacio();
    expect(i.version).toBe(2);
    expect(i.categorias.map((c) => c.id)).toEqual([
      "identidad", "vivienda", "vehiculo", "seguros", "salud", "finanzas", "trabajo", "legal", "otros",
    ]);
    expect(i.categorias.find((c) => c.id === "trabajo")?.nombre).toBe("Trabajo y estudios");
  });

  it("las carpetas base no se pueden alterar desde fuera", () => {
    expect(Object.isFrozen(CATEGORIAS_BASE)).toBe(true);
    expect(Object.isFrozen(CATEGORIAS_BASE[0])).toBe(true);
  });

  it("un índice de la versión 1 se lee: mismas carpetas, documentos en su sitio, misma revisión", () => {
    const d = doc("vivienda");
    const viejo = JSON.stringify({ version: 1, revision: 7, documentos: [d] });
    const leido = leerIndice(viejo);
    expect(leido.version).toBe(2);
    expect(leido.revision).toBe(7);
    expect(leido.categorias).toEqual(CATEGORIAS_BASE);
    expect(leido.documentos).toEqual([d]);
  });

  it("en la versión 1 un documento con una carpeta que ya no existe pasa a «otros»", () => {
    const viejo = JSON.stringify({ version: 1, revision: 1, documentos: [doc("inventada")] });
    expect(leerIndice(viejo).documentos[0]?.categoria).toBe("otros");
  });

  it("un índice de la versión 2 con carpetas propias se guarda y se abre igual", () => {
    const { caja } = crearCaja(SecretBuffer.fromText("clave de prueba larga"), { perfil: "test" });
    const { indice: con, categoria } = conCategoriaNueva(indiceVacio(), "Coche de empresa");
    const i: Indice = { ...con, documentos: [doc(categoria.id)] };
    expect(caja.abrirIndice(caja.sellarIndice(i))).toEqual(i);
  });

  it("un documento apunta a una carpeta que no existe: no impide abrir la caja, va a la de reserva", () => {
    const json = JSON.stringify({
      version: 2,
      revision: 3,
      categorias: [{ id: "otros", nombre: "Otros" }, { id: "a1", nombre: "Una" }],
      documentos: [doc("fantasma")],
    });
    expect(leerIndice(json).documentos[0]?.categoria).toBe("otros");
  });

  it("si la carpeta de reserva no existe, va a la primera", () => {
    const json = JSON.stringify({
      version: 2,
      revision: 3,
      categorias: [{ id: "coche", nombre: "Coche" }, { id: "casa", nombre: "Casa" }],
      documentos: [doc("fantasma")],
    });
    expect(leerIndice(json).documentos[0]?.categoria).toBe("coche");
  });

  it("una lista de carpetas vacía cae en las de base: sin carpetas no hay dónde poner nada", () => {
    const json = JSON.stringify({ version: 2, revision: 0, categorias: [], documentos: [] });
    expect(leerIndice(json).categorias).toEqual(CATEGORIAS_BASE);
  });

  it("valida la forma de las carpetas: lista, ids, repetidas y nombres", () => {
    const con = (categorias: unknown) =>
      JSON.stringify({ version: 2, revision: 0, categorias, documentos: [] });
    expect(() => leerIndice(con(undefined))).toThrow(/lista de carpetas/);
    expect(() => leerIndice(con({}))).toThrow(CajaFormatoError);
    expect(() => leerIndice(con(["x"]))).toThrow(/no es un objeto/);
    expect(() => leerIndice(con([{ id: "A B", nombre: "x" }]))).toThrow(/identificador/);
    expect(() => leerIndice(con([{ id: "", nombre: "x" }]))).toThrow(/identificador/);
    expect(() => leerIndice(con([{ id: "ok", nombre: "" }]))).toThrow(/nombre/);
    expect(() => leerIndice(con([{ id: "ok", nombre: "x".repeat(201) }]))).toThrow(/nombre/);
    expect(() => leerIndice(con([{ id: "ok", nombre: 5 }]))).toThrow(CajaFormatoError);
    expect(() => leerIndice(con([{ id: "ok", nombre: "a" }, { id: "ok", nombre: "b" }]))).toThrow(/repite/);
  });

  it("con carpetas propias, una caja con pocos documentos y otra con bastantes siguen pesando lo mismo", () => {
    const { caja } = crearCaja(SecretBuffer.fromText("clave de prueba larga"), { perfil: "test" });
    let i = indiceVacio();
    for (let n = 0; n < 12; n++) i = conCategoriaNueva(i, `Carpeta propia número ${n}`).indice;
    const tamanos = [0, 3, 20, 30].map(
      (n) => caja.sellarIndice({ ...i, documentos: Array.from({ length: n }, (_, k) => doc("otros", k)) }).length,
    );
    expect(new Set(tamanos).size).toBe(1);
  });

  it("los nombres de las carpetas no se ven en el índice cifrado", () => {
    const { caja } = crearCaja(SecretBuffer.fromText("clave de prueba larga"), { perfil: "test" });
    const { indice } = conCategoriaNueva(indiceVacio(), "Herencia de la abuela Remedios");
    const sellado = caja.sellarIndice(indice);
    expect(toHex(sellado)).not.toContain(toHex(new TextEncoder().encode("Remedios")));
  });
});

describe("carpetas: crear", () => {
  it("añade al final, con un identificador de azar, y sube la revisión", () => {
    const base = indiceVacio();
    const { indice, categoria } = conCategoriaNueva(base, "Coche");
    expect(indice.categorias.at(-1)).toEqual(categoria);
    expect(indice.categorias).toHaveLength(base.categorias.length + 1);
    expect(categoria.id).toMatch(/^[0-9a-f]{16}$/);
    expect(indice.revision).toBe(base.revision + 1);
    expect(base.categorias).toHaveLength(9); // el original no se toca
  });

  it("deja el nombre en su forma canónica", () => {
    expect(normalizarNombreCategoria("  Coche   de \t empresa \n")).toBe("Coche de empresa");
    // «í» escrita como «i» + acento combinado es la misma letra que «í».
    expect(normalizarNombreCategoria("Vehículo")).toBe("Vehículo");
    expect(normalizarNombreCategoria("a\u0000b\u0007c")).toBe("abc");
  });

  it("rechaza vacío, solo espacios y demasiado largo", () => {
    expect(() => conCategoriaNueva(indiceVacio(), "")).toThrow(/necesita un nombre/);
    expect(() => conCategoriaNueva(indiceVacio(), " \n\t ")).toThrow(CategoriaError);
    expect(() => conCategoriaNueva(indiceVacio(), "x".repeat(MAX_NOMBRE_CATEGORIA + 1))).toThrow(/demasiado largo/);
    expect(() => conCategoriaNueva(indiceVacio(), "x".repeat(MAX_NOMBRE_CATEGORIA))).not.toThrow();
  });

  it("no admite dos carpetas con el mismo nombre, sin importar mayúsculas ni acentos", () => {
    for (const repetido of ["Vehículo", "vehiculo", "VEHÍCULO", "  vehiculo  "]) {
      expect(() => conCategoriaNueva(indiceVacio(), repetido), repetido).toThrow(/Ya hay una carpeta/);
    }
  });

  it("tiene un tope de carpetas", () => {
    let i = indiceVacio();
    for (let n = i.categorias.length; n < MAX_CATEGORIAS; n++) i = conCategoriaNueva(i, `Carpeta ${n}`).indice;
    expect(i.categorias).toHaveLength(MAX_CATEGORIAS);
    expect(() => conCategoriaNueva(i, "Una más")).toThrow(/más de/);
  });
});

describe("carpetas: renombrar", () => {
  it("cambia el nombre sin tocar ningún documento", () => {
    const base = conDocs("vivienda", "vivienda", "salud");
    const nuevo = conCategoriaRenombrada(base, "vivienda", "Casa y piso");
    expect(nuevo.categorias.find((c) => c.id === "vivienda")?.nombre).toBe("Casa y piso");
    expect(nuevo.documentos).toEqual(base.documentos);
    expect(nuevo.revision).toBe(base.revision + 1);
  });

  it("si el nombre no cambia devuelve el mismo índice, sin subir la revisión", () => {
    const base = indiceVacio();
    expect(conCategoriaRenombrada(base, "salud", "  Salud ")).toBe(base);
  });

  it("puede cambiar solo las mayúsculas o los acentos de su propio nombre", () => {
    const nuevo = conCategoriaRenombrada(indiceVacio(), "vehiculo", "VEHICULO");
    expect(nuevo.categorias.find((c) => c.id === "vehiculo")?.nombre).toBe("VEHICULO");
  });

  it("no puede quitarle el nombre a otra carpeta", () => {
    expect(() => conCategoriaRenombrada(indiceVacio(), "salud", "seguros")).toThrow(/Ya hay una carpeta/);
  });

  it("falla con una carpeta que no existe", () => {
    expect(() => conCategoriaRenombrada(indiceVacio(), "no-existe", "x")).toThrow(/ya no existe/);
  });
});

describe("carpetas: borrar", () => {
  it("una carpeta vacía se borra sin más", () => {
    const base = conDocs("salud");
    const nuevo = sinCategoria(base, "vivienda");
    expect(existeCategoria(nuevo, "vivienda")).toBe(false);
    expect(nuevo.documentos).toEqual(base.documentos);
    expect(nuevo.revision).toBe(base.revision + 1);
  });

  it("con documentos dentro hay que decir adónde van, y nunca se pierden", () => {
    const base = conDocs("vivienda", "vivienda", "salud");
    expect(() => sinCategoria(base, "vivienda")).toThrow(/elige a qué carpeta/);
    const nuevo = sinCategoria(base, "vivienda", "otros", 99);
    expect(existeCategoria(nuevo, "vivienda")).toBe(false);
    expect(nuevo.documentos).toHaveLength(3);
    expect(nuevo.documentos.map((d) => d.categoria)).toEqual(["otros", "otros", "salud"]);
    // Los que se movieron anotan el cambio; el otro queda como estaba.
    expect(nuevo.documentos.map((d) => d.actualizado)).toEqual([99, 99, 2]);
  });

  it("el destino tiene que existir y ser otra carpeta", () => {
    const base = conDocs("vivienda");
    expect(() => sinCategoria(base, "vivienda", "vivienda")).toThrow(/destino/);
    expect(() => sinCategoria(base, "vivienda", "no-existe")).toThrow(/destino/);
  });

  it("tiene que quedar al menos una carpeta", () => {
    let i: Indice = { ...indiceVacio(), categorias: [{ id: "unica", nombre: "Única" }] };
    expect(() => sinCategoria(i, "unica")).toThrow(/al menos una/);
    i = { ...i, categorias: [...i.categorias, { id: "otra", nombre: "Otra" }] };
    expect(sinCategoria(i, "unica").categorias).toHaveLength(1);
  });

  it("una carpeta que no existe falla", () => {
    expect(() => sinCategoria(indiceVacio(), "no-existe")).toThrow(/ya no existe/);
  });

  it("lo borrado y lo movido sobrevive a sellar y abrir", () => {
    const { caja } = crearCaja(SecretBuffer.fromText("clave de prueba larga"), { perfil: "test" });
    const base = conDocs("vivienda", "salud");
    const nuevo = sinCategoria(conCategoriaNueva(base, "Coche").indice, "vivienda", "salud");
    expect(caja.abrirIndice(caja.sellarIndice(nuevo))).toEqual(nuevo);
  });
});
