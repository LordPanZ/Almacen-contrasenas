# Extensión de navegador de Cerbero

```bash
pnpm --filter @cerbero/extension build
# Chrome/Edge: chrome://extensions → Modo desarrollador → Cargar descomprimida → apps/extension/dist
```

## Para qué sirve de verdad

Una extensión de gestor de contraseñas no vale por ahorrarte teclear: vale por
**negarse a escribir donde no debe**. Tú puedes caer en una página que parece tu
banco; el que compara cadenas, no. Todo lo demás en este directorio existe para
sostener esa idea.

### La regla

Una credencial solo se rellena si:

1. La página va cifrada (o es `localhost`, donde no hay red que espiar).
2. El **nombre de host coincide exactamente** con el guardado.
3. Si es un subdominio, la entrada lo autoriza expresamente.
4. No es un marco de otro origen.

La regla 4 cierra un agujero que la mayoría de gestores deja abierto: cualquier
página puede incrustar un `iframe` con aspecto de formulario de acceso, y una
extensión que mire solo el origen del marco entrega la contraseña a quien lo
incrustó. Aquí se comprueba en dos sitios —el fondo y el script de contenido—,
que tendrían que fallar los dos a la vez.

La comprobación se repite **en el momento de rellenar**, contra la URL que
reporta la pestaña. Si solo se hiciera al listar, bastaría una redirección entre
el listado y el clic para escribir la contraseña en otro sitio.

### Cuando se niega, lo explica

Es la mitad que suele faltar. Si la extensión simplemente no ofrece nada, la
conclusión natural del usuario es «vaya, falla» y teclea la contraseña a mano,
que es justo lo que espera quien montó la página. Por eso cada negativa dice
exactamente por qué, y hay dos avisos específicos:

- **Dominio que te suplanta.** `banco.es.atacante.com` lleva tu dominio delante
  para que lo leas con prisa; el dueño del sitio es `atacante.com`.
- **Homógrafo.** `xn--banc-85d.es` se lee «bancо.es» con una «о» cirílica:
  idéntico a la vista, otro dominio. La extensión descodifica el punycode,
  reduce el nombre a su esqueleto latino y lo compara con los que tienes
  guardados.

### Credenciales trampa

Si lo que se rellena es un canario, se levanta una alarma y queda anotado en el
registro Merkle. Tú nunca usas esas credenciales, así que su uso es prueba de
que alguien tiene acceso a tu bóveda.

## Cómo está montada

```
fondo.ts       Trabajador de fondo: el ÚNICO sitio donde vive la bóveda abierta
popup.tsx      Interfaz. Pide acciones; nunca recibe un secreto
contenido.ts   Encuentra el formulario y lo rellena. No conoce la bóveda
origen.ts      La regla de coincidencia, punycode y detección de imitaciones
```

El secreto viaja del fondo directamente a la pestaña, **sin pasar por el popup**.
Una vulnerabilidad en el popup —que es una página web corriente, y por tanto la
superficie más expuesta— no entrega el almacén.

La bóveda se bloquea sola tras diez minutos de inactividad. Un navegador se queda
abierto días, y sin plazo la bóveda seguiría descifrada en memoria mientras el
equipo se suspende o pasa de mano en mano.

## Límites conocidos

- El script de contenido escribe simulando entrada real (asignador nativo más
  eventos `input`/`change`), porque asignar `.value` a secas no despierta a React
  ni a Vue y el formulario se enviaría vacío. Aun así, algún sitio con lógica muy
  peculiar puede resistirse.
- La lista de sufijos públicos es corta. Solo se usa para decidir si una regla de
  subdominio sería absurda, y equivocarse por exceso de celo solo obliga a
  guardar el host completo, que es lo recomendable de todas formas.
- Sin iconos: el manifiesto no los declara todavía.
