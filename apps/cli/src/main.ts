import { CerberoError, SecretBuffer, toHex, utf8Encode } from "@cerbero/crypto";
import {
  createVault,
  addVaultSlot,
  vaultFileInfo,
  type VaultItemDraft,
  type VaultItemType,
} from "@cerbero/vault";
import { verifyInclusion } from "@cerbero/ledger";
import {
  BreachOracle,
  checkPasswordAgainstBreaches,
  createCanarySet,
  estimateStrength,
  generateCanaryKey,
  generatePassphrase,
  generatePassword,
  isCanary,
} from "@cerbero/sentinel";
import { analizarArgumentos, opcionBooleana, opcionNumero, opcionTexto } from "./args.ts";
import {
  abrirSesion,
  escribirAtomico,
  existe,
  guardarSesion,
  leerFichero,
  rutaPorDefecto,
  type SesionAbierta,
} from "./vault-file.ts";
import {
  aviso,
  color,
  confirmar,
  error,
  escribir,
  exito,
  pedirContrasena,
  pedirContrasenaNueva,
  preguntar,
  tabla,
  titulo,
} from "./terminal.ts";

const AYUDA = `${color.negrita("cerbero")} — almacén de contraseñas de conocimiento cero

${color.negrita("USO")}
  cerbero <comando> [opciones]

${color.negrita("BÓVEDA")}
  init                     Crea una bóveda nueva
  add [título]             Añade una entrada
  list [búsqueda]          Lista las entradas (sin mostrar secretos)
  get <id|búsqueda>        Muestra una entrada con su secreto
  remove <id>              Borra una entrada
  info                     Datos públicos del fichero

${color.negrita("PROTECCIÓN")}
  duress                   Añade una bóveda de coacción con otra contraseña
  canary [--cantidad N]    Siembra credenciales trampa
  check [--todas]          Comprueba filtraciones sin revelar nada
  gen [--frase]            Genera una contraseña o frase

${color.negrita("AUDITORÍA")}
  audit [--verificar]      Muestra el historial y verifica su integridad

${color.negrita("OPCIONES GLOBALES")}
  --vault <ruta>           Fichero de bóveda (por defecto ~/.cerbero/boveda.cerbero
                           o la variable CERBERO_VAULT)
  --help                   Esta ayuda
`;

function rutaDe(args: ReturnType<typeof analizarArgumentos>): string {
  return opcionTexto(args, "vault") ?? rutaPorDefecto();
}

/** Abre la bóveda pidiendo la contraseña, y anota el desbloqueo. */
async function conSesion<T>(
  ruta: string,
  fn: (sesion: SesionAbierta) => Promise<T>,
): Promise<T> {
  if (!(await existe(ruta))) {
    throw new CerberoError(`no hay ninguna bóveda en ${ruta}. Créala con: cerbero init`);
  }
  const password = await pedirContrasena("Contraseña maestra");
  let sesion: SesionAbierta;
  try {
    sesion = await abrirSesion(ruta, password);
  } finally {
    password.destroy();
  }
  try {
    sesion.registro.append({ type: "vault-unlocked" });
    return await fn(sesion);
  } finally {
    // Pase lo que pase, las claves no sobreviven al comando.
    sesion.vault.lock();
  }
}

async function comandoInit(args: ReturnType<typeof analizarArgumentos>): Promise<void> {
  const ruta = rutaDe(args);
  if (await existe(ruta)) {
    throw new CerberoError(`ya existe una bóveda en ${ruta}. Bórrala o usa --vault con otra ruta.`);
  }

  titulo("Crear bóveda");
  escribir(
    color.tenue(
      "La contraseña maestra es el único secreto que Cerbero no puede recuperar por ti.\n" +
        "Usa una frase larga: la longitud protege más que los símbolos raros.",
    ),
  );
  escribir();

  const password = await pedirContrasenaNueva();
  const fuerza = estimateStrength(new TextDecoder().decode(password.bytes));
  escribir(`  Fortaleza estimada: ${fuerza.bits} bits (${fuerza.veredicto})`);
  for (const texto of fuerza.avisos) aviso(texto);

  if (fuerza.bits < 60 && !(await confirmar("Esa contraseña es floja. ¿Seguir igualmente?"))) {
    password.destroy();
    escribir("Cancelado.");
    return;
  }

  const perfil = opcionTexto(args, "perfil") ?? "moderate";
  escribir(color.tenue(`\nDerivando la clave maestra con Argon2id (perfil ${perfil})...`));

  const { file, vault } = createVault(password, {
    argon2Profile: perfil as "interactive" | "moderate" | "paranoid",
    slotCount: opcionNumero(args, "ranuras", 4),
    slotSize: opcionNumero(args, "tamano-ranura", 256 * 1024),
  });
  password.destroy();

  const { AuditLedger } = await import("@cerbero/ledger");
  const registro = AuditLedger.create(vault.signingKeyPair());
  registro.append({ type: "vault-created" });
  vault.auditLog = registro.serialize();

  await escribirAtomico(ruta, vault.serialize());
  const info = vaultFileInfo(file);
  vault.lock();

  exito(`Bóveda creada en ${ruta}`);
  escribir(`  Ranuras: ${info.slotCount} × ${(info.slotSize / 1024).toFixed(0)} KiB`);
  escribir(
    color.tenue(
      "\n  Todas las ranuras son indistinguibles entre sí. Puedes añadir una bóveda\n" +
        "  de coacción con otra contraseña usando: cerbero duress",
    ),
  );
}

function tipoDeItem(valor: string | undefined): VaultItemType {
  const tipos = ["login", "note", "card", "identity", "key"] as const;
  if (valor && (tipos as readonly string[]).includes(valor)) return valor as VaultItemType;
  return "login";
}

async function comandoAdd(args: ReturnType<typeof analizarArgumentos>): Promise<void> {
  await conSesion(rutaDe(args), async (sesion) => {
    titulo("Nueva entrada");
    const title = args.posicionales[0] ?? (await preguntar("Título"));
    if (title.trim() === "") throw new CerberoError("el título no puede estar vacío");

    const tipo = tipoDeItem(opcionTexto(args, "tipo"));
    const username = await preguntar("Usuario", "");
    const url = await preguntar("Dirección", "");

    let secret = opcionTexto(args, "secreto");
    if (secret === undefined) {
      if (await confirmar("¿Generar una contraseña?", true)) {
        secret = generatePassword({ longitud: opcionNumero(args, "longitud", 20) });
        escribir(`  Generada: ${color.cian(secret)}`);
      } else {
        const introducida = await pedirContrasena("Secreto");
        secret = new TextDecoder().decode(introducida.bytes);
        introducida.destroy();
      }
    }

    const etiquetas = (await preguntar("Etiquetas (separadas por comas)", ""))
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    const draft: VaultItemDraft = {
      type: tipo,
      title,
      ...(username ? { username } : {}),
      ...(url ? { url } : {}),
      ...(secret ? { secret } : {}),
      ...(etiquetas.length > 0 ? { tags: etiquetas } : {}),
    };

    const item = sesion.vault.add(draft);
    sesion.registro.append({ type: "item-added", detail: utf8Encode(item.id) });
    await guardarSesion(sesion);

    exito(`Guardada "${item.title}"`);
    escribir(color.tenue(`  id: ${item.id}`));
    const fuerza = estimateStrength(secret ?? "");
    escribir(color.tenue(`  fortaleza: ${fuerza.bits} bits (${fuerza.veredicto})`));
  });
}

async function comandoList(args: ReturnType<typeof analizarArgumentos>): Promise<void> {
  await conSesion(rutaDe(args), async (sesion) => {
    const consulta = args.posicionales.join(" ");
    // Siempre se trabaja con el ítem completo: `list()` devuelve resúmenes sin
    // secreto, y aquí hace falta el secreto para saber si es una trampa.
    const items = consulta
      ? sesion.vault.find(consulta)
      : sesion.vault
          .list()
          .map((resumen) => sesion.vault.get(resumen.id))
          .filter((item) => item !== undefined);
    const claveCanario = generateCanaryKey(sesion.vault.identityKeyPair().publicKey);

    titulo(consulta ? `Entradas que coinciden con "${consulta}"` : "Entradas");
    tabla(
      ["ID", "TIPO", "TÍTULO", "USUARIO", "ETIQUETAS"],
      items.map((item) => {
        const trampa =
          item.secret && isCanary(item.secret, claveCanario) ? color.amarillo(" [trampa]") : "";
        return [
          item.id.slice(0, 8),
          item.type,
          `${item.title}${trampa}`,
          item.username ?? "",
          item.tags.join(", "),
        ];
      }),
    );
    escribir();
    escribir(
      color.tenue(
        `  ${items.length} entrada${items.length === 1 ? "" : "s"} · ` +
          `${((sesion.vault.usedBytes / sesion.vault.capacityBytes) * 100).toFixed(1)}% de la ranura`,
      ),
    );
  });
}

async function comandoGet(args: ReturnType<typeof analizarArgumentos>): Promise<void> {
  const consulta = args.posicionales.join(" ");
  if (!consulta) throw new CerberoError("indica un identificador o un texto de búsqueda");

  await conSesion(rutaDe(args), async (sesion) => {
    const directo = sesion.vault.get(consulta);
    const coincidencias = directo
      ? [directo]
      : sesion.vault.find(consulta).concat(
          sesion.vault.list().filter((i) => i.id.startsWith(consulta)).map((i) => sesion.vault.get(i.id)!),
        );

    if (coincidencias.length === 0) throw new CerberoError(`nada coincide con "${consulta}"`);
    if (coincidencias.length > 1) {
      aviso(`${coincidencias.length} coincidencias; muestro la primera.`);
    }

    const item = coincidencias[0]!;
    sesion.registro.append({ type: "item-read", detail: utf8Encode(item.id) });
    await guardarSesion(sesion);

    titulo(item.title);
    escribir(`  Tipo:     ${item.type}`);
    if (item.username) escribir(`  Usuario:  ${item.username}`);
    if (item.url) escribir(`  Dirección: ${item.url}`);
    if (item.secret) escribir(`  Secreto:  ${color.cian(item.secret)}`);
    if (item.notes) escribir(`  Notas:    ${item.notes}`);
    if (item.tags.length > 0) escribir(`  Etiquetas: ${item.tags.join(", ")}`);
    escribir(color.tenue(`  id: ${item.id}`));

    const claveCanario = generateCanaryKey(sesion.vault.identityKeyPair().publicKey);
    if (item.secret && isCanary(item.secret, claveCanario)) {
      escribir();
      aviso("Esta es una CREDENCIAL TRAMPA. Si no la has sembrado tú, alguien ha entrado.");
    }
  });
}

async function comandoRemove(args: ReturnType<typeof analizarArgumentos>): Promise<void> {
  const id = args.posicionales[0];
  if (!id) throw new CerberoError("indica el identificador de la entrada a borrar");

  await conSesion(rutaDe(args), async (sesion) => {
    const item = sesion.vault.get(id);
    if (!item) throw new CerberoError(`no existe ninguna entrada con el identificador ${id}`);
    if (!(await confirmar(`¿Borrar "${item.title}"?`))) {
      escribir("Cancelado.");
      return;
    }
    sesion.vault.remove(id);
    sesion.registro.append({ type: "item-removed", detail: utf8Encode(id) });
    await guardarSesion(sesion);
    exito(`Borrada "${item.title}"`);
  });
}

async function comandoInfo(args: ReturnType<typeof analizarArgumentos>): Promise<void> {
  const ruta = rutaDe(args);
  if (!(await existe(ruta))) throw new CerberoError(`no hay ninguna bóveda en ${ruta}`);

  const file = await leerFichero(ruta);
  const info = vaultFileInfo(file);

  titulo("Datos públicos del fichero");
  escribir(`  Ruta:        ${ruta}`);
  escribir(`  Tamaño:      ${(file.length / 1024).toFixed(1)} KiB`);
  escribir(`  Versión:     ${info.version}`);
  escribir(`  Ranuras:     ${info.slotCount} × ${(info.slotSize / 1024).toFixed(0)} KiB`);
  escribir(`  Argon2id:    t=${info.argon2.timeCost} m=${info.argon2.memoryKiB}KiB p=${info.argon2.parallelism}`);
  escribir(`  Sal:         ${toHex(info.salt).slice(0, 32)}...`);
  escribir();
  escribir(
    color.tenue(
      "  Esto es TODO lo que revela el fichero. No dice cuántas bóvedas contiene,\n" +
        "  ni cuántas entradas hay, ni de qué servicios: los metadatos van dentro\n" +
        "  del cifrado y las ranuras sin usar son ruido indistinguible.",
    ),
  );
}

async function comandoDuress(args: ReturnType<typeof analizarArgumentos>): Promise<void> {
  const ruta = rutaDe(args);
  if (!(await existe(ruta))) throw new CerberoError(`no hay ninguna bóveda en ${ruta}`);

  titulo("Añadir bóveda de coacción");
  escribir(
    color.tenue(
      "Una bóveda que se abre con OTRA contraseña, la que darías si te obligan.\n" +
        "Nadie puede demostrar, mirando el fichero, que existe más de una.\n" +
        "Ponle dentro cosas creíbles: una bóveda vacía no engaña a nadie.",
    ),
  );
  escribir();

  escribir(color.negrita("Contraseña actual (la de tu bóveda real):"));
  const actual = await pedirContrasena("Contraseña maestra");
  escribir();

  // Cerbero no puede saber qué ranuras están ocupadas: esa imposibilidad es lo
  // que hace negable el fichero. Si ya tienes otra bóveda de coacción, hay que
  // declararla o la nueva podría caer encima y borrarla en silencio.
  const anteriores: SecretBuffer[] = [];
  if (await confirmar("¿Ya tienes otra bóveda de coacción en este fichero?")) {
    escribir(color.tenue("  Introdúcelas para que la nueva no las pise. Línea vacía para terminar."));
    for (;;) {
      const otra = await pedirContrasena("Otra contraseña (vacío = terminar)");
      if (otra.length === 0) {
        otra.destroy();
        break;
      }
      anteriores.push(otra);
    }
  }
  escribir();
  escribir(color.negrita("Contraseña de coacción (distinta, y que puedas recordar bajo presión):"));
  const coaccion = await pedirContrasenaNueva("Contraseña de coacción");

  try {
    const actualizado = addVaultSlot(await leerFichero(ruta), {
      existingPassword: actual,
      otherPasswords: anteriores,
      newPassword: coaccion,
      items: [
        { type: "login", title: "Correo personal", username: "usuario@ejemplo.com", secret: generatePassword() },
        { type: "login", title: "Tienda en línea", username: "usuario@ejemplo.com", secret: generatePassword() },
        { type: "note", title: "Wifi de casa", notes: `Clave: ${generatePassword({ longitud: 14 })}` },
      ],
    });
    await escribirAtomico(ruta, actualizado);
    exito("Bóveda de coacción creada.");
    escribir(
      color.tenue(
        "  El fichero pesa exactamente lo mismo que antes y su cabecera no ha cambiado.\n" +
          "  Añádele entradas con: cerbero add (usando la contraseña de coacción)",
      ),
    );
  } finally {
    actual.destroy();
    coaccion.destroy();
    for (const clave of anteriores) clave.destroy();
  }
}

async function comandoCanary(args: ReturnType<typeof analizarArgumentos>): Promise<void> {
  await conSesion(rutaDe(args), async (sesion) => {
    const cantidad = opcionNumero(args, "cantidad", 3);
    const clave = generateCanaryKey(sesion.vault.identityKeyPair().publicKey);
    const canarios = createCanarySet(clave, cantidad);

    titulo("Sembrar credenciales trampa");
    for (const canario of canarios) {
      sesion.vault.add({
        type: "login",
        title: canario.servicio,
        username: canario.usuario,
        secret: canario.secret,
      });
    }
    sesion.registro.append({ type: "policy-changed", detail: utf8Encode(`canarios:${cantidad}`) });
    await guardarSesion(sesion);

    tabla(
      ["SERVICIO", "USUARIO"],
      canarios.map((c) => [c.servicio, c.usuario]),
    );
    escribir();
    exito(`${cantidad} credenciales trampa sembradas.`);
    escribir(
      color.tenue(
        "  Son indistinguibles de las reales para quien robe la bóveda, pero Cerbero\n" +
          "  las reconoce. Tú nunca las usas: cualquier uso es una intrusión.\n" +
          "  `cerbero list` te las marca con [trampa].",
      ),
    );
  });
}

async function comandoCheck(args: ReturnType<typeof analizarArgumentos>): Promise<void> {
  await conSesion(rutaDe(args), async (sesion) => {
    // Corpus de demostración. En producción, el índice lo publica un servicio
    // y se descarga; el protocolo es el mismo.
    const oracle = BreachOracle.create();
    const indice = oracle.indexBreachedPasswords([
      "123456", "password", "qwerty", "111111", "123123", "abc123", "1234567890",
      "iloveyou", "admin", "welcome", "monkey", "dragon", "letmein", "football",
      "verano2024", "contraseña", "hola123", "madrid", "barcelona", "12345678",
    ]);

    titulo("Comprobación de filtraciones");
    escribir(
      color.tenue(
        "El servidor evalúa sobre un punto cegado: no aprende tu contraseña,\n" +
          "ni su hash, ni un prefijo, ni si dos consultas fueron de la misma.",
      ),
    );
    escribir();

    const filas: string[][] = [];
    let filtradas = 0;
    for (const resumen of sesion.vault.list()) {
      const item = sesion.vault.get(resumen.id);
      if (!item?.secret) continue;
      const resultado = checkPasswordAgainstBreaches(oracle, indice, item.secret);
      const fuerza = estimateStrength(item.secret);
      if (resultado.filtrada) filtradas++;
      filas.push([
        item.title,
        resultado.filtrada ? color.rojo("FILTRADA") : color.verde("limpia"),
        `${fuerza.bits} bits`,
        fuerza.veredicto,
      ]);
    }
    oracle.destroy();

    tabla(["ENTRADA", "FILTRACIÓN", "ENTROPÍA", "VEREDICTO"], filas);
    escribir();
    if (filtradas > 0) {
      aviso(`${filtradas} contraseña${filtradas === 1 ? "" : "s"} aparece${filtradas === 1 ? "" : "n"} en filtraciones conocidas. Cámbiala${filtradas === 1 ? "" : "s"}.`);
    } else {
      exito("Ninguna de tus contraseñas aparece en el corpus consultado.");
    }
  });
}

async function comandoAudit(args: ReturnType<typeof analizarArgumentos>): Promise<void> {
  await conSesion(rutaDe(args), async (sesion) => {
    await auditar(sesion.registro, opcionBooleana(args, "verificar"));
  });
}

async function auditar(
  registro: import("@cerbero/ledger").AuditLedger,
  verificar: boolean,
): Promise<void> {
  titulo("Registro de auditoría");
  const entradas = registro.entries();
  tabla(
    ["#", "FECHA", "SUCESO"],
    entradas.slice(-25).map((entrada) => [
      String(entrada.index),
      new Date(entrada.timestamp).toLocaleString("es-ES"),
      entrada.type,
    ]),
  );

  escribir();
  escribir(`  Entradas: ${registro.size}`);
  escribir(`  Raíz Merkle: ${toHex(registro.rootHash).slice(0, 32)}...`);

  if (verificar) {
    escribir();
    titulo("Verificación de integridad");

    let todasBien = true;
    for (let i = 0; i < registro.size; i++) {
      const prueba = registro.inclusionProof(i);
      const { entryHash } = await import("@cerbero/ledger");
      const ok = verifyInclusion(
        registro.rootHash,
        entryHash(entradas[i]!),
        i,
        registro.size,
        prueba,
      );
      if (!ok) {
        error(`la entrada ${i} NO supera su prueba de inclusión`);
        todasBien = false;
      }
    }

    if (todasBien) {
      exito(`Las ${registro.size} entradas superan su prueba de inclusión.`);
    }
    escribir(
      color.tenue(
        "\n  Esto demuestra que el historial no ha sido reescrito. Un servidor que\n" +
          "  borrara o alterara una entrada pasada no podría producir estas pruebas.",
      ),
    );
  } else {
    escribir(color.tenue("\n  Usa --verificar para comprobar criptográficamente la integridad."));
  }
}

function comandoGen(args: ReturnType<typeof analizarArgumentos>): void {
  const cantidad = opcionNumero(args, "cantidad", 5);
  const frase = opcionBooleana(args, "frase");

  titulo(frase ? "Frases de contraseña" : "Contraseñas");
  for (let i = 0; i < cantidad; i++) {
    const generada = frase
      ? generatePassphrase({ palabras: opcionNumero(args, "palabras", 7) })
      : generatePassword({
          longitud: opcionNumero(args, "longitud", 20),
          excluirAmbiguos: opcionBooleana(args, "sin-ambiguos"),
        });
    const fuerza = estimateStrength(generada);
    escribir(`  ${color.cian(generada)}  ${color.tenue(`${fuerza.bits} bits`)}`);
  }
}

async function principal(): Promise<number> {
  const args = analizarArgumentos(process.argv.slice(2));

  if (args.comando === "" || opcionBooleana(args, "help") || opcionBooleana(args, "h")) {
    escribir(AYUDA);
    return 0;
  }

  try {
    switch (args.comando) {
      case "init":
        await comandoInit(args);
        break;
      case "add":
        await comandoAdd(args);
        break;
      case "list":
      case "ls":
        await comandoList(args);
        break;
      case "get":
        await comandoGet(args);
        break;
      case "remove":
      case "rm":
        await comandoRemove(args);
        break;
      case "info":
        await comandoInfo(args);
        break;
      case "duress":
        await comandoDuress(args);
        break;
      case "canary":
        await comandoCanary(args);
        break;
      case "check":
        await comandoCheck(args);
        break;
      case "audit":
        await comandoAudit(args);
        break;
      case "gen":
        comandoGen(args);
        break;
      default:
        error(`comando desconocido: ${args.comando}`);
        escribir(AYUDA);
        return 1;
    }
    return 0;
  } catch (fallo) {
    if (fallo instanceof CerberoError) {
      error(fallo.message);
      return 1;
    }
    if (fallo instanceof Error && fallo.message === "cancelado") {
      escribir("\nCancelado.");
      return 130;
    }
    throw fallo;
  }
}

principal()
  .then((codigo) => process.exit(codigo))
  .catch((fallo: unknown) => {
    error(fallo instanceof Error ? fallo.message : String(fallo));
    process.exit(1);
  });
