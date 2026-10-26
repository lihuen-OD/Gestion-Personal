# Fichador como terminal dedicado (kiosco)

Fecha: 2026-10-26. Estado: el **modo mantenimiento** está implementado en la aplicación. El **modo kiosco del sistema operativo** está documentado y **no validado** en dispositivos físicos.

El fichador es la misma PWA en todos los equipos: tablet Android, iPad/iPhone o ChromeOS. Para usarlo como terminal dedicado se combinan dos capas con responsabilidades distintas.

> **El modo mantenimiento de la PWA no reemplaza el bloqueo kiosco del sistema operativo.**

## Lo que hace nuestra aplicación

| Función | Dónde | Detalle |
|---|---|---|
| Pairing | Fichador + Admin | El equipo muestra un código de vinculación y RRHH lo aprueba en **Admin → Configuración → Dispositivos de fichada** |
| Identidad del dispositivo | Fichador | Credencial individual `ClockDevice` en el IndexedDB del equipo. No hay token compartido |
| Heartbeat | Fichador → backend | Cada 60 s y al volver a primer plano. Admin muestra "En línea" o "Sin conexión" |
| Modo mantenimiento | Fichador | Se abre presionando 5 s el título "Fichador de personal" y pide un código temporal de RRHH. Muestra diagnóstico y permite volver, recargar o reconfigurar |
| Código temporal | Admin → backend | 6 dígitos, 5 minutos, un solo uso, sólo para ese dispositivo. Abre una sesión de mantenimiento de 10 minutos |
| Reconfiguración | Fichador (modo mantenimiento) | Con confirmación escrita, borra **sólo** la vinculación guardada en el equipo. No toca fichadas, historial ni el backend |
| Revocación | Admin | Bloquea el equipo en la próxima comunicación, también si está en modo mantenimiento |

## Lo que hace el sistema operativo

| Función | Android | Apple (iPad/iPhone) | ChromeOS |
|---|---|---|---|
| Impedir cerrar la aplicación | Fijar app / lock task | Acceso guiado / modo de app única | Modo kiosco |
| Impedir abrir otras apps | Lock task | Acceso guiado / modo de app única | Modo kiosco |
| Impedir volver al escritorio | Lock task | Acceso guiado / modo de app única | Modo kiosco |
| Autoarranque | Según el DPC/EMM | Modo de app única con MDM (equipo supervisado) | Autoarranque de la app kiosco desde la consola de administración |
| Salida del kiosco | Gesto + PIN del equipo o la consola del EMM | Código de Acceso guiado o el MDM | La consola de administración |

Guías por plataforma, con lo que falta verificar:

- [ANDROID.md](ANDROID.md)
- [APPLE.md](APPLE.md)
- [CHROMEOS.md](CHROMEOS.md)

Operación diaria de RRHH: [OPERACION_RRHH.md](OPERACION_RRHH.md).

## Cómo encajan las dos capas

```text
Persona que ficha ──> Fichador (PWA) ── sólo buscar, fichar, foto
                         │
     RRHH (5 s sobre el título + código de Admin)
                         └─> Modo mantenimiento ── diagnóstico, recargar, reconfigurar

Sistema operativo en modo kiosco ── impide salir de la PWA (cerrar, otras apps, escritorio)
     └─ para salir: el código o la administración DEL SISTEMA, nunca el código de mantenimiento
```

Son dos credenciales distintas, y ninguna se escribe en el equipo ni queda a la vista:

- **Código de mantenimiento** (de la app): lo genera RRHH en Admin para cada ocasión y vale 5 minutos.
- **Código o administración del kiosco** (del sistema operativo): lo define quien administra los equipos.

## Seguridad: lo que la app no hace a propósito

- No hay PIN maestro: ni en el código, ni en variables `VITE_*`, ni en el almacenamiento del navegador, ni compartido entre equipos.
- No hay un botón visible de "Administración" o "Salir".
- No intenta bloquear el sistema operativo desde JavaScript: un navegador no puede impedir que se cierre la app ni que se cambie de app.
- El modo mantenimiento no puede revocar el dispositivo, borrar datos del backend, cambiar el establecimiento ni tocar la configuración global.

Diseño completo y modelo de amenazas: [docs/decisions/FICHADOR_MAINTENANCE_MODE.md](../decisions/FICHADOR_MAINTENANCE_MODE.md).

## Pendientes

- Configurar y validar el kiosco real en Android, Apple y ChromeOS.
- Pruebas físicas por dispositivo: la matriz de [FICHADOR_F12_LOCAL_CLOSURE_AND_DEVICE_COMPATIBILITY.md](../decisions/FICHADOR_F12_LOCAL_CLOSURE_AND_DEVICE_COMPATIBILITY.md) §5, que ya incluye "Acceso guiado o modo kiosco equivalente".
- Cámara al perder el foco: el comportamiento observado al cambiar de app en Mac se valida con el kiosco real; no se tocó.
