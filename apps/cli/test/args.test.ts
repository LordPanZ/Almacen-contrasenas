import { describe, expect, it } from "vitest";
import { analizarArgumentos, opcionBooleana, opcionNumero, opcionTexto } from "../src/args.ts";

describe("analizador de argumentos", () => {
  it("separa comando, posicionales y opciones", () => {
    const args = analizarArgumentos(["add", "github", "--tipo", "login", "--favorito"]);
    expect(args.comando).toBe("add");
    expect(args.posicionales).toEqual(["github"]);
    expect(opcionTexto(args, "tipo")).toBe("login");
    expect(opcionBooleana(args, "favorito")).toBe(true);
  });

  it("acepta la forma --clave=valor", () => {
    const args = analizarArgumentos(["init", "--perfil=paranoid", "--ranuras=8"]);
    expect(opcionTexto(args, "perfil")).toBe("paranoid");
    expect(opcionNumero(args, "ranuras", 4)).toBe(8);
  });

  it("agrupa banderas cortas", () => {
    const args = analizarArgumentos(["list", "-lv"]);
    expect(opcionBooleana(args, "l")).toBe(true);
    expect(opcionBooleana(args, "v")).toBe(true);
  });

  it("trata todo lo posterior a -- como posicional", () => {
    const args = analizarArgumentos(["get", "--", "--esto-no-es-una-opcion"]);
    expect(args.posicionales).toEqual(["--esto-no-es-una-opcion"]);
    expect(args.opciones["esto-no-es-una-opcion"]).toBeUndefined();
  });

  it("una opción seguida de otra opción es booleana", () => {
    const args = analizarArgumentos(["audit", "--verificar", "--desde", "3"]);
    expect(opcionBooleana(args, "verificar")).toBe(true);
    expect(opcionNumero(args, "desde", 0)).toBe(3);
  });

  it("devuelve el valor por defecto cuando el número no es válido", () => {
    const args = analizarArgumentos(["x", "--n", "no-es-un-numero"]);
    expect(opcionNumero(args, "n", 7)).toBe(7);
    expect(opcionNumero(args, "ausente", 7)).toBe(7);
  });

  it("no se rompe sin argumentos", () => {
    const args = analizarArgumentos([]);
    expect(args.comando).toBe("");
    expect(args.posicionales).toEqual([]);
  });
});
