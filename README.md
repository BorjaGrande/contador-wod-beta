# Contador WOD 2.2.4 Beta — Ejercicios y estadísticas

Basado en la v2.2.3 adjuntada. Conserva las claves locales de sesión y preferencias, el contador de vueltas original, la cuenta atrás opcional, los cronómetros y el protocolo de importación y devolución de resultados al Generador.

- Ficha desplegable del WOD importado con nombre, ejercicios y cantidades originales (incluidas cargas cuando figuran en el texto recibido). No inventa cargas ni captura las reales.
- EMOM: estación actual siguiendo el orden de los ejercicios importados; TABATA: ejercicio del bloque cuando hay correspondencia inequívoca entre movimientos y bloques, con indicación del siguiente bloque durante la pausa adicional.
- AMRAP y FOR TIME: última vuelta, media, mejor, más lenta, gráfico de parciales y diferencia respecto a la vuelta anterior. Al finalizar, tiempo posterior a la última marca separado de la media. Solo usa las marcas efectivamente registradas; un FOR TIME finalizado sin marcar la última vuelta no genera automáticamente una marca.
- EMOM: intervalos marcados manualmente; TABATA: trabajos cuyo tiempo ha transcurrido, no repeticiones ni rendimiento medido. Se mantiene el registro original.
- CSV: añade ficha de ejercicios importada y resumen de parciales. Las sesiones manuales sin ficha conservan el cronómetro y las estadísticas, sin mostrar ejercicios inventados.
- Se incrementa la versión de caché offline; no cambia la estructura de los datos de sesión. La persistencia sigue siendo local, sin historial acumulado nuevo.

## Instalación
Exportar los resultados necesarios, terminar las sesiones activas y subir los nueve archivos a la raíz del repositorio del Contador WOD que se utiliza para pruebas. No borrar datos ni desinstalar. Comprobar el pie «Contador WOD 2.2.4 · Beta» y abrir desde el Generador 1.0.19 Beta. No hace falta actualizar el Generador para esta fase si ya envía la instantánea del WOD.

## Validación
Sintaxis JavaScript y pruebas automatizadas de lógica con DOM simulado: AMRAP (parciales, media, extremos, diferencias, parcial final, pausa, restauración y deshacer), FOR TIME, EMOM, TABATA (bloques con y sin pausas), sesión manual, límite de tiempo y enlace de devolución. La prueba de navegación local de Chromium fue bloqueada por el entorno; pendiente validación visual y funcional en iPhone, PWA/offline, CSV real y transferencia completa entre aplicaciones.
