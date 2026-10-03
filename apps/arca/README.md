# Arca

Aplicación web para guardar **documentos** cifrados: DNI, escrituras, seguros,
PDF y fotos. Corre **entera en el navegador**; no hay servidor.

Es independiente de Cerbero (el gestor de contraseñas): otra contraseña, otro
formato, otra dirección web. Cómo funciona por dentro, qué cifra y qué no cubre:
[docs/ARCA.md](../../docs/ARCA.md).

```bash
pnpm --filter @cerbero/arca-web dev            # desarrollo
pnpm --filter @cerbero/arca-web build:suelto   # UN solo fichero: arca.html
pnpm run construir:arca                         # lo prepara para publicar (dist-sitio/)
```

## Qué hace

- **Añadir** uno o varios archivos a la vez, o hacer una foto con la cámara, y
  elegir su categoría. Hasta 50 MiB cada uno, de cualquier tipo.
- Las **fotos pierden el EXIF** (ubicación GPS, modelo del móvil, hora) al
  guardarse; una casilla lo permite desactivar.
- **Buscar** por nombre, categoría o notas, y filtrar por categoría.
- **Ver** las imágenes con zoom; **descargar** cualquier documento descifrado.
- **Renombrar**, recategorizar y anotar. **Borrar** con confirmación.
- **Copia de seguridad** de toda la caja en un solo fichero `.arca`, y
  restauración validada antes de escribir nada.
- **Cambiar la contraseña** sin recifrar los documentos.
- **Bloqueo automático** por inactividad.

## Cómo está montada

Toda la criptografía y el acceso a IndexedDB viven en un *web worker*
(`arca.worker.ts`). Es el único que ve las claves: la interfaz nunca recibe la
clave de datos ni un criptograma, y el Argon2 de desbloquear no congela la
pantalla. Los archivos viajan al trabajador *transferidos*, no copiados.

El núcleo está en [`@cerbero/arca`](../../packages/arca) y no depende de ninguna
interfaz: se prueba entero con `vitest`.

## Solo funciona desde su dirección web

Abierta como fichero del disco el navegador da a la página un origen anónimo
distinto en cada carga y no guarda nada entre sesiones; Arca lo detecta y lo
dice. Sirve el fichero suelto desde una dirección https.
