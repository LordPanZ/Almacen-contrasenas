import { CerberoError } from "@cerbero/crypto";

/**
 * Fallo propio del registro de auditoría: cadena rota, formato corrupto o una
 * operación que exige la clave de firma en un registro cargado sin ella.
 *
 * Se distingue de `InvalidInputError` (argumento fuera de contrato) porque aquí
 * el problema es el *estado* del registro, y eso es justamente lo que un
 * usuario debe poder distinguir de un error de programación suyo: un fallo de
 * cadena al cargar un fichero significa que alguien lo manipuló.
 */
export class LedgerError extends CerberoError {}
