# Contador WOD 2.2 — BETA PARA PRUEBAS

Esta es una versión de pruebas: **no reemplaza el contador 2.1 que ya usas**. La beta emplea claves de almacenamiento independientes para que los dos proyectos, incluso publicados en GitHub Pages bajo el mismo usuario, no sobrescriban sus sesiones. El service worker usa una caché aislada por ruta de repositorio.

## Publicarla

1. En GitHub crea un **nuevo repositorio público** llamado `contador-wod-beta`.
2. Sube todos los archivos de esta carpeta a la **raíz** del repositorio.
3. En `Settings > Pages`, selecciona `Deploy from a branch`, `main`, `/(root)`.
4. Abre `https://TU-USUARIO.github.io/contador-wod-beta/` en Safari. Si quieres, añádela a inicio con el nombre `Contador WOD Beta`.
5. Comprueba la indicación «Modo sin conexión preparado» y prueba en modo avión después de abrirla con internet.

## Pruebas de aceptación

- Vueltas: inicia, suma, pausa, conserva tiempos al salir, deshace, exporta CSV y el sonido funciona.
- AMRAP: cuenta atrás, registra rondas, finaliza en el límite, permite añadir repeticiones.
- FOR TIME: cuenta arriba, registra vueltas, finaliza manualmente y con cap.
- EMOM: avanza entre intervalos, permite marcar cada intervalo, finaliza al último.
- TABATA: alterna trabajo/descanso y finaliza correctamente.
- Todos los modos: se reanudan tras cerrar/abrir, pausa no descuenta tiempo y operan sin conexión.
- Pantalla encendida: con la opción activada, verifica en iPhone que no se bloquea por inactividad. La compatibilidad depende de iOS.
- Si los avisos están activados, verifica los pitidos con la app abierta; no son alarmas de segundo plano.

## Producción

Tras validar en iPhone, publicar el paquete de producción correspondiente en el repositorio `contador-wod`, después de etiquetar el último commit estable como `v2.1.0`. La compilación de producción mantiene la clave de almacenamiento original `contador-vueltas-v2`.
