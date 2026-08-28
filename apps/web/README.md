# Interfaz de Cerbero

Aplicación web que corre **entera en el navegador**. No hay servidor: se sirve
como ficheros estáticos, así que no existe ninguna máquina que pudiera ver tus
secretos aunque quisiera.

```bash
pnpm --filter @cerbero/web dev      # desarrollo
pnpm --filter @cerbero/web build    # ficheros estáticos en dist/
```

## Cómo está montada

Toda la criptografía vive en un *web worker* (`boveda.worker.ts`), por dos
razones:

1. **Interfaz.** Derivar la clave maestra con Argon2id ocupa cientos de MiB y
   varios segundos. En el hilo principal congelaría la ventana entera.
2. **Seguridad.** La bóveda abierta, su clave de ranura y los secretos
   descifrados nunca entran en la memoria del hilo que pinta la interfaz. Lo que
   cruza la frontera son datos ya escogidos, y el secreto de una entrada solo
   cuando se pide explícitamente.

El fichero cifrado se guarda en IndexedDB por comodidad —es exactamente el mismo
fichero que habría en disco, sin nada descifrado—, pero limpiar los datos del
sitio lo borra. La copia de seguridad de verdad es la que descarga el usuario.

## Decisiones de interfaz

- **La espera de Argon2 se enseña, no se disimula.** Mientras deriva, la pantalla
  explica cuánta memoria está ocupando y por qué: ese coste es justo lo que le
  cuesta a un atacante cada intento contra el fichero robado.
- **La tira de ranuras** aparece en la portada y en la vista del fichero. Todas
  se dibujan idénticas, con el mismo barrido, porque así son: no se puede saber
  cuáles contienen una bóveda. Es la tesis del producto hecha imagen.
- **Nunca se muestra qué ranura abrió tu contraseña.** Si quien te coacciona
  viera "ranura 2" y supiera que la primera bóveda se coloca al azar, deduciría
  que hay otra.
