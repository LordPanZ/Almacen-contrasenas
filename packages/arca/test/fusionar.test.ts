import { describe, expect, it } from "vitest";
import { SecretBuffer } from "@cerbero/crypto";
import {
  MAX_NOMBRE_CATEGORIA,
  conCategoriaNueva,
  conCategoriaRenombrada,
  crearCaja,
  indiceVacio,
  nuevoIdDocumento,
  planearFusion,
  sinCategoria,
  type DocumentoMeta,
  type Indice,
} from "../src/index.ts";

const doc = (nombre: string, categoria = "otros", actualizado = 10, id = nuevoIdDocumento()): DocumentoMeta => ({
  id,
  nombre,
  mime: "application/pdf",
  tam: 1000,
  categoria,
  notas: "",
  creado: 1,
  actualizado,
});

const con = (...documentos: DocumentoMeta[]): Indice => ({ ...indiceVacio(), documentos });

/** Dos copias que parten de la misma caja y divergen. */
function copias() {
  const comun = doc("DNI.jpg", "identidad", 10);
  const base = con(comun);
  return { comun, base, a: { ...base, revision: 3 } as Indice, b: { ...base, revision: 5 } as Indice };
}

describe("combinar copias: qué se suma", () => {
  it("un documento que solo está en la otra copia se añade, con su carpeta", () => {
    const { a, b } = copias();
    const nuevo = doc("Escritura.pdf", "vivienda", 20);
    const plan = planearFusion(a, { ...b, documentos: [...b.documentos, nuevo] });
    expect(plan?.documentosNuevos).toEqual([nuevo]);
    expect(plan?.indice.documentos.map((d) => d.nombre)).toEqual(["DNI.jpg", "Escritura.pdf"]);
    expect(plan?.indice.documentos[1]?.categoria).toBe("vivienda");
  });

  it("sube la revisión del índice de aquí, no la de la otra", () => {
    const { a, b } = copias();
    const plan = planearFusion(a, { ...b, documentos: [...b.documentos, doc("x.pdf")] });
    expect(plan?.indice.revision).toBe(a.revision + 1);
  });

  it("si la otra copia no trae nada que no tengas, no hay nada que hacer", () => {
    const { a, b } = copias();
    expect(planearFusion(a, b)).toBeNull();
    // Y combinar dos veces lo mismo no cambia nada la segunda.
    const plan = planearFusion(a, { ...b, documentos: [...b.documentos, doc("x.pdf")] })!;
    expect(planearFusion(plan.indice, { ...b, documentos: [...b.documentos, plan.documentosNuevos[0]!] })).toBeNull();
  });

  it("nunca quita nada de lo que ya tienes", () => {
    const { a, b } = copias();
    const mio = doc("Solo mío.pdf", "salud", 30);
    const suyo = doc("Solo suyo.pdf", "seguros", 30);
    const plan = planearFusion({ ...a, documentos: [...a.documentos, mio] }, { ...b, documentos: [...b.documentos, suyo] });
    const nombres = plan!.indice.documentos.map((d) => d.nombre);
    expect(nombres).toContain("Solo mío.pdf");
    expect(nombres).toContain("Solo suyo.pdf");
    expect(nombres).toContain("DNI.jpg");
  });

  it("no modifica ninguno de los dos índices que recibe", () => {
    const { a, b } = copias();
    const otro = { ...b, documentos: [...b.documentos, doc("x.pdf")] };
    const antesA = JSON.stringify(a);
    const antesB = JSON.stringify(otro);
    planearFusion(a, otro);
    expect(JSON.stringify(a)).toBe(antesA);
    expect(JSON.stringify(otro)).toBe(antesB);
  });
});

describe("combinar copias: cuando las dos tocaron el mismo documento", () => {
  it("gana lo editado más tarde, y el contenido no cambia", () => {
    const { a, b, comun } = copias();
    const editadoFuera = { ...comun, nombre: "DNI de Ana.jpg", notas: "caduca en 2031", categoria: "salud", actualizado: 50, tam: 999_999 };
    const plan = planearFusion(a, { ...b, documentos: [editadoFuera] });
    const d = plan!.indice.documentos.find((x) => x.id === comun.id)!;
    expect(d.nombre).toBe("DNI de Ana.jpg");
    expect(d.notas).toBe("caduca en 2031");
    expect(d.categoria).toBe("salud");
    expect(d.actualizado).toBe(50);
    // El tamaño y el tipo son del contenido, que es inmutable: no se toman de la otra.
    expect(d.tam).toBe(comun.tam);
    expect(plan!.documentosActualizados).toHaveLength(1);
    expect(plan!.documentosNuevos).toHaveLength(0);
  });

  it("si lo editado aquí es más reciente, se queda lo de aquí", () => {
    const { a, b, comun } = copias();
    const miEdicion = { ...comun, nombre: "Mío.jpg", actualizado: 90 };
    const suEdicion = { ...comun, nombre: "Suyo.jpg", actualizado: 50 };
    expect(planearFusion({ ...a, documentos: [miEdicion] }, { ...b, documentos: [suEdicion] })).toBeNull();
  });

  it("con la misma hora de edición se queda lo de aquí: no hay nada que ganar", () => {
    const { a, b, comun } = copias();
    expect(planearFusion({ ...a, documentos: [{ ...comun, nombre: "A.jpg", actualizado: 70 }] }, { ...b, documentos: [{ ...comun, nombre: "B.jpg", actualizado: 70 }] })).toBeNull();
  });
});

describe("combinar copias: carpetas", () => {
  it("una carpeta que solo está en la otra se añade, aunque esté vacía", () => {
    const { a, b } = copias();
    const { indice: conCoche } = conCategoriaNueva(b, "Coche");
    const plan = planearFusion(a, conCoche);
    expect(plan?.categoriasNuevas.map((c) => c.nombre)).toEqual(["Coche"]);
    expect(plan?.indice.categorias.at(-1)?.nombre).toBe("Coche");
    expect(plan?.indice.categorias).toHaveLength(a.categorias.length + 1);
  });

  it("los documentos nuevos llegan a su carpeta, también si la carpeta es nueva", () => {
    const { a, b } = copias();
    const { indice: conCoche, categoria } = conCategoriaNueva(b, "Coche");
    const plan = planearFusion(a, { ...conCoche, documentos: [...conCoche.documentos, doc("ITV.pdf", categoria.id)] });
    const itv = plan!.indice.documentos.find((d) => d.nombre === "ITV.pdf")!;
    expect(itv.categoria).toBe(categoria.id);
    expect(plan!.indice.categorias.some((c) => c.id === categoria.id)).toBe(true);
  });

  it("dos carpetas distintas con el mismo nombre no se confunden: la que llega se distingue", () => {
    const { a, b } = copias();
    const { indice: aCoche } = conCategoriaNueva(a, "Coche");
    const { indice: bCoche } = conCategoriaNueva(b, "coche"); // otro identificador, mismo nombre
    const plan = planearFusion(aCoche, bCoche);
    const nombres = plan!.indice.categorias.map((c) => c.nombre);
    expect(nombres).toContain("Coche");
    expect(nombres).toContain("coche (copia)");
    expect(new Set(plan!.indice.categorias.map((c) => c.id)).size).toBe(plan!.indice.categorias.length);
  });

  it("el sufijo respeta el máximo de caracteres y se numera si hace falta", () => {
    const largo = "x".repeat(MAX_NOMBRE_CATEGORIA);
    const { a, b } = copias();
    const { indice: aLargo } = conCategoriaNueva(a, largo);
    let bLargo = conCategoriaNueva(b, largo).indice;
    bLargo = { ...bLargo, categorias: [...bLargo.categorias, { id: "otro-id", nombre: largo.toUpperCase() }] };
    const plan = planearFusion(aLargo, bLargo);
    for (const c of plan!.categoriasNuevas) expect([...c.nombre].length).toBeLessThanOrEqual(MAX_NOMBRE_CATEGORIA);
    const claves = plan!.indice.categorias.map((c) => c.nombre.toLowerCase());
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("una carpeta renombrada en la otra no pisa el nombre que le diste aquí", () => {
    const { a, b } = copias();
    const renombrada = conCategoriaRenombrada(b, "vivienda", "Casa");
    expect(planearFusion(a, renombrada)).toBeNull();
  });

  it("un documento que apunta a una carpeta que no existe en ninguna cae en «Otros»", () => {
    const { a, b } = copias();
    const plan = planearFusion(a, { ...b, documentos: [...b.documentos, doc("raro.pdf", "inventada")] });
    expect(plan!.indice.documentos.find((d) => d.nombre === "raro.pdf")?.categoria).toBe("otros");
  });

  it("si aquí falta «Otros», lo huérfano cae en la primera carpeta", () => {
    const { a, b } = copias();
    const sinOtros = sinCategoria(a, "otros");
    const plan = planearFusion(sinOtros, { ...b, categorias: b.categorias.filter((c) => c.id !== "otros"), documentos: [...b.documentos, doc("raro.pdf", "inventada")] });
    expect(plan!.indice.documentos.find((d) => d.nombre === "raro.pdf")?.categoria).toBe(sinOtros.categorias[0]!.id);
  });
});

describe("combinar copias: lo que NO hace, dicho en un test para que nadie lo dé por hecho", () => {
  it("borrar no se propaga: lo borrado aquí y presente en la otra vuelve a aparecer", () => {
    const { a, b, comun } = copias();
    const sinElDni: Indice = { ...a, documentos: [] }; // aquí se borró
    const plan = planearFusion(sinElDni, b); // allí sigue
    expect(plan?.documentosNuevos.map((d) => d.id)).toEqual([comun.id]);
  });
});

describe("combinar copias: de verdad son la misma caja", () => {
  it("el índice combinado se sella y se abre con la misma clave de datos", () => {
    const { caja } = crearCaja(SecretBuffer.fromText("clave de prueba larga"), { perfil: "test" });
    const { a, b } = copias();
    const plan = planearFusion(a, { ...b, documentos: [...b.documentos, doc("nuevo.pdf", "salud", 99)] })!;
    expect(caja.abrirIndice(caja.sellarIndice(plan.indice))).toEqual(plan.indice);
  });
});
