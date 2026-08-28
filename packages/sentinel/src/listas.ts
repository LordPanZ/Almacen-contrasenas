/**
 * Catálogos embebidos.
 *
 * Van dentro del paquete a propósito: un canario que dependiera de una lista
 * descargada delataría al titular ante quien observe la red, y un evaluador de
 * fortaleza que consultara un servicio filtraría la contraseña que evalúa.
 */

/**
 * Servicios verosímiles para los señuelos. La mezcla de banca, nube, comercio y
 * suministros imita el reparto real de una bóveda personal: una bóveda con diez
 * entradas de criptomonedas y nada más canta tanto como un señuelo mal hecho.
 */
export const SERVICIOS_SENUELO: readonly string[] = [
  "Banco Santander",
  "BBVA",
  "CaixaBank",
  "ING Direct",
  "Bankinter",
  "PayPal",
  "Stripe",
  "Coinbase",
  "Kraken",
  "Revolut",
  "Amazon",
  "El Corte Inglés",
  "Zalando",
  "AliExpress",
  "MediaMarkt",
  "Netflix",
  "HBO Max",
  "Spotify",
  "Movistar Plus",
  "Steam",
  "Twitch",
  "GitHub",
  "GitLab",
  "Cloudflare",
  "DigitalOcean",
  "Hetzner",
  "Vercel",
  "Docker Hub",
  "npm",
  "Atlassian Jira",
  "Slack",
  "Notion",
  "Trello",
  "Figma",
  "Dropbox",
  "Google Workspace",
  "Microsoft 365",
  "Zoom",
  "LinkedIn",
  "Mailchimp",
  "WordPress",
  "Iberia",
  "Renfe",
  "Vueling",
  "Booking",
  "Endesa",
  "Iberdrola",
  "Naturgy",
  "Movistar",
  "Vodafone",
  "Orange",
  "Correos",
  "Agencia Tributaria",
  "Seguridad Social",
  "DGT",
  "Mutua Madrileña",
  "Sanitas",
  "Adeslas",
  "Decathlon",
  "Leroy Merlin",
];

/** Nombres de pila para construir usuarios con pinta de haberlos escrito una persona. */
export const NOMBRES_SENUELO: readonly string[] = [
  "alba", "alejandro", "ana", "andres", "angel", "antonio", "beatriz", "belen",
  "carlos", "carmen", "clara", "cristina", "daniel", "david", "diego", "elena",
  "elsa", "emilio", "eva", "fernando", "gabriel", "gema", "gonzalo", "hector",
  "ignacio", "irene", "isabel", "javier", "jorge", "jose", "juan", "julia",
  "laura", "lucia", "luis", "manuel", "marcos", "maria", "marta", "mateo",
  "miguel", "nerea", "nuria", "olga", "oscar", "pablo", "patricia", "paula",
  "pedro", "raquel", "raul", "roberto", "rocio", "rosa", "ruben", "sara",
  "sergio", "silvia", "teresa", "victor",
];

/** Apellidos frecuentes: un usuario "nombre.apellido" es el formato más común. */
export const APELLIDOS_SENUELO: readonly string[] = [
  "alonso", "alvarez", "blanco", "cabrera", "campos", "cano", "castro", "cortes",
  "delgado", "diaz", "dominguez", "duran", "espinosa", "fernandez", "ferrer",
  "flores", "garcia", "garrido", "gil", "gomez", "gonzalez", "guerrero",
  "gutierrez", "herrera", "hernandez", "iglesias", "jimenez", "lopez", "lorenzo",
  "marin", "martin", "martinez", "medina", "mendez", "molina", "montero",
  "morales", "moreno", "munoz", "navarro", "nieto", "ortega", "ortiz", "pascual",
  "perez", "prieto", "ramirez", "ramos", "reyes", "rodriguez", "rojas", "romero",
  "rubio", "ruiz", "sanchez", "santos", "serrano", "soto", "torres", "vargas",
  "vazquez", "vega", "vidal",
];

/** Dominios de correo verosímiles para los usuarios de los señuelos. */
export const DOMINIOS_SENUELO: readonly string[] = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.es",
  "icloud.com",
  "protonmail.com",
  "correo.es",
  "telefonica.net",
];

/**
 * Lista de palabras para frases de contraseña. Palabras cortas, sin tildes y sin
 * prefijos comunes que las hagan ambiguas al teclear; todas distintas entre sí,
 * porque la entropía anunciada es `palabras x log2(lista)` y una lista con
 * duplicados anuncia más de la que entrega.
 */
export const PALABRAS_FRASE: readonly string[] = [
  "abeja", "abrigo", "aceite", "acero", "agua", "aguila", "ajedrez", "alambre",
  "alba", "aldea", "alga", "almeja", "altura", "amapola", "ambar", "ancla",
  "anillo", "antorcha", "arado", "arbol", "arcilla", "arena", "arpa", "arroyo",
  "asta", "atlas", "avena", "avion", "azafran", "azucar", "bahia", "balcon",
  "ballena", "bambu", "bandera", "barco", "barro", "bastion", "bosque", "bote",
  "brasa", "brisa", "bronce", "brujula", "buho", "cabana", "cable", "cactus",
  "cadena", "caja", "calma", "camello", "camino", "campana", "canela", "cantera",
  "caoba", "caracol", "carbon", "cartel", "cascada", "castor", "cebolla", "cedro",
  "ceniza", "cera", "cereza", "cielo", "cierva", "cima", "circo", "ciruela",
  "cisne", "clavo", "cobre", "cocina", "codigo", "colina", "columna", "cometa",
  "concha", "conejo", "coral", "corona", "cortina", "cosecha", "coyote", "cristal",
  "cuaderno", "cuadro", "cuchara", "cuerda", "cuervo", "cueva", "cumbre", "cuna",
  "dado", "danza", "dedal", "delfin", "desierto", "diamante", "dibujo", "duna",
  "eclipse", "eco", "embudo", "enebro", "erizo", "escala", "escoba", "espada",
  "espejo", "espiga", "espuma", "estanque", "estrella", "faro", "fibra", "fiesta",
  "flauta", "flecha", "flor", "foca", "fogata", "fresa", "fresno", "fruta",
  "fuego", "fuente", "galaxia", "galera", "ganso", "garza", "gaviota", "gema",
  "girasol", "globo", "golfo", "gorrion", "granito", "granja", "grulla", "guante",
  "guitarra", "gusano", "hacha", "halcon", "harina", "helecho", "hielo", "hierba",
  "higuera", "hilo", "hoguera", "hoja", "hongo", "hormiga", "horno", "huerto",
  "humo", "huso", "iglesia", "iman", "invierno", "isla", "jabali", "jarra",
  "jazmin", "jirafa", "joya", "junco", "jungla", "kiwi", "laberinto", "lago",
  "lampara", "lana", "lanza", "lapiz", "laurel", "lava", "leche", "lechuza",
  "lena", "leon", "libro", "liebre", "lienzo", "lima", "limon", "linterna",
  "lirio", "llama", "llanura", "lluvia", "lobo", "loma", "loro", "luna",
  "madera", "maiz", "malva", "manada", "mango", "manta", "manzana", "mapa",
  "mar", "marfil", "mariposa", "marmol", "mastil", "mecha", "medusa", "mejilla",
  "melon", "membrillo", "menta", "mesa", "metal", "miel", "mina", "mirlo",
  "molino", "montana", "mora", "morsa", "mosaico", "muelle", "muralla", "musgo",
  "nabo", "naranja", "nardo", "nave", "nebulosa", "nectar", "nido", "niebla",
  "nieve", "nogal", "norte", "nube", "nudo", "nutria", "oasis", "obelisco",
  "oceano", "ocre", "olivo", "olmo", "onda", "orca", "orilla", "oro",
  "ortiga", "osa", "otono", "oveja", "pagina", "paisaje", "paja", "pala",
  "palma", "paloma", "pantano", "panal", "papel", "parra", "pasillo", "pato",
  "pecera", "pedal", "pelota", "pena", "pera", "perla", "pescado", "petalo",
  "piano", "picaflor", "piedra", "pincel", "pino", "pinza", "pipa", "piragua",
  "pizarra", "planeta", "plata", "playa", "pluma", "polen", "polvo", "portico",
  "pozo", "pradera", "presa", "puente", "puerto", "pulpo", "puma", "quebrada",
  "queso", "quijote", "quinta", "rabano", "radar", "raiz", "rama", "rana",
  "raton", "rayo", "redoble", "reja", "remo", "reptil", "resina", "revista",
  "riachuelo", "ribera", "rincon", "rio", "risco", "roble", "roca", "rocio",
  "rombo", "ronda", "rosa", "rueda", "ruina", "sabana", "sabio", "sal",
  "salmon", "salto", "sandia", "sardina", "sauce", "seda", "selva", "sello",
  "semilla", "sendero", "serpiente", "seta", "sierra", "silla", "sirena", "sol",
  "soga", "sombra", "sonda", "soplo", "sur", "surco", "tabla", "taller",
  "tambor", "tapiz", "tejado", "tejon", "telar", "templo", "tienda", "tierra",
  "tigre", "tinta", "tobillo", "tomillo", "tordo", "tormenta", "torre", "tortuga",
  "trigo", "trineo", "trueno", "tuba", "tulipan", "tunel", "turbina", "urna",
  "vaina", "valle", "vapor", "vara", "vela", "veleta", "vena", "ventana",
  "verano", "verja", "viento", "vinagre", "vino", "violeta", "viruta", "vison",
  "volcan", "yate", "yegua", "yema", "yunque", "zafiro", "zanja", "zapato",
  "zarza", "zorro", "zumo",
];

/**
 * Palabras y contraseñas que aparecen en cabeza de todas las filtraciones. No
 * pretende ser exhaustiva —para eso está la verificación OPRF— sino barata:
 * detecta de un vistazo el caso en el que la contraseña es una sola palabra.
 */
export const PALABRAS_DEBILES: readonly string[] = [
  "abcdef", "acceso", "administrador", "admin", "adobe", "alejandro", "amigo",
  "amor", "andrea", "angel", "antonio", "apple", "asdfgh", "azerty", "banco",
  "barcelona", "baseball", "batman", "bienvenido", "bonita", "cambiame",
  "carlos", "casa", "chocolate", "cielo", "computer", "contrasena", "contrasenya",
  "cristina", "cuenta", "daniel", "dragon", "elena", "entrar", "escuela",
  "espana", "familia", "fernando", "flower", "football", "fuckyou", "futbol",
  "gabriel", "geheim", "gestor", "google", "guitarra", "hello", "hockey",
  "hola", "iloveyou", "internet", "javier", "jennifer", "jesus", "jordan",
  "julian", "keyboard", "killer", "letmein", "libertad", "login", "madrid",
  "maestro", "manuel", "maria", "martin", "master", "matrix", "michael",
  "monkey", "mustang", "naruto", "ninguna", "olvidada", "pass", "passwd",
  "password", "patata", "pepito", "perro", "peter", "photoshop", "pokemon",
  "princesa", "princess", "prueba", "qazwsx", "qwerty", "qwertz", "ranger",
  "sabado", "samsung", "sandra", "secreto", "seguridad", "shadow", "silver",
  "soccer", "sofia", "starwars", "summer", "sunshine", "superman", "susana",
  "telefono", "tequiero", "test", "thomas", "trustno", "usuario", "valencia",
  "vaquero", "verano", "welcome", "whatever", "william", "zaragoza",
];

/**
 * Recorridos que un atacante prueba de entrada: filas del teclado, alfabeto y
 * dígitos. Se comprueban en ambos sentidos, porque "4321" es tan predecible
 * como "1234".
 */
export const SECUENCIAS_PREDECIBLES: readonly string[] = [
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "qwertzuiop",
  "1qaz2wsx",
  "!@#$%^&*()",
];
