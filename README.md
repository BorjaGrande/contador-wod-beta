# Contador WOD 2.2.6 Beta — CAP en segundos y transferencia precisa

Base: 2.2.5 Beta validada. FOR TIME manual: CAP de 00:01 a 60:00, 00:00 sin límite. Acepta enlaces del Generador 1.0.22 con `capseconds` y antiguos con `cap` en minutos. Mantiene compatibilidad con sesiones antiguas, objetivo de rondas y finalización por CAP. Los resultados se muestran con décimas y se transmiten con milisegundos exactos. No modifica los cronómetros de otros formatos ni las claves de almacenamiento.

Instalación: finalizar/exportar entrenamientos necesarios, sustituir los nueve archivos de la raíz del repositorio `contador-wod-beta`, comprobar versión y después actualizar Generador a 1.0.22 Beta. No borrar datos ni tocar repositorios estables. Validación de sintaxis, límites CAP, compatibilidad de configuraciones antiguas y precisión del protocolo con Node.js/DOM simulado. Navegación Chromium bloqueada: pendiente validación real de cronómetro y formulario en iPhone. No publicado.

---

# Contador WOD 2.2.5 Beta — Finalización FOR TIME por rondas

Actualización sobre 2.2.4 Beta. Los enlaces nuevos del Generador 1.0.21 Beta incluyen el objetivo de rondas. El contador muestra el progreso, termina al registrar la última ronda y conserva exactamente su tiempo como resultado. El botón de registro queda desactivado. CAP o detención manual anterior al objetivo: resultado incompleto. Los FOR TIME independientes o enlaces antiguos sin objetivo siguen permitiendo finalizar manualmente. No se altera la clave de sesión ni se reinterpretan los entrenamientos históricos. No se modifica el cronómetro TABATA, EMOM, AMRAP ni el modo Vueltas original.

Instalación: finalizar/exportar las sesiones necesarias, subir los nueve archivos de este ZIP a la raíz de `contador-wod-beta`, después actualizar el Generador a 1.0.21 Beta. No borrar almacenamiento ni publicar en la versión estable. Comprobar el pie de versión con conexión.

Validación: sintaxis JavaScript y pruebas Node.js con DOM simulado de objetivo, quinto registro exacto, bloqueo de sexta ronda, persistencia, CAP, finalización manual, enlaces antiguos, transferencia y regresión de AMRAP, EMOM y TABATA. La navegación local de Chromium está bloqueada por el entorno. Pendiente de validar en iPhone/Safari, caché real y guardado definitivo del resultado en la interfaz. No publicado en GitHub.

---

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
