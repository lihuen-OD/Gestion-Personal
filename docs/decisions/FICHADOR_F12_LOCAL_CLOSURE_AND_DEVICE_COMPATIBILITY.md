# F12 — cierre local y compatibilidad física diferida a staging público

Fecha de decisión: 2026-10-15.

Esta decisión actualiza el estado operativo de F12 sin reescribir el historial
de F0–F11.1 ni cambiar runtime, arquitectura o contratos. La preparación previa
del piloto iPad por LAN queda como evidencia técnica; no es un fallo ni una
validación física terminada.

## 1. Estado vigente

| Alcance | Estado |
|---|---|
| F0–F11.1 | CERRADAS |
| F12-local | **PASS** |
| F12 infraestructura LAN | **TECHNICALLY VALIDATED / PHYSICAL DEVICE TEST DEFERRED** |
| F12 device compatibility | **DEFERRED TO PUBLIC STAGING** |
| F12 public staging | PENDIENTE |
| F13 — rollout a producción | NO INICIADA |
| F14 — reconocimiento facial | FUERA DE ESTA ETAPA; requiere definición propia |

## 2. Evidencia de F12-local

La validación funcional y técnica se ejecutó contra backend y PostgreSQL de
staging desde Mac, con el build `cc8e4fc-local-pwa`. Quedaron comprobados:

- identidad persistente y autenticación individual de `ClockDevice`;
- `device/status`, estado `ACTIVE`, heartbeat y transición real
  En línea → Sin conexión → En línea;
- PWA, Service Worker, shell offline, persistencia de identidad y recuperación
  offline → online;
- cierre y reapertura sin nuevo pairing;
- cámara y liberación de tracks al perder visibilidad, sin reapertura automática;
- IN/OUT, idempotencia, recovery y cooldown;
- auditoría, storage y evidencia fotográfica;
- CORS estricto, CSP enforced, MediaPipe self-hosted y namespace exclusivo
  `/api/clock/*`.

Por lo tanto, **F12-local queda cerrada en PASS**.

## 3. Decisión sobre compatibilidad física

No se continúa ahora con una prueba física específica de iPad mediante
certificados LAN. El hardware final todavía no está seleccionado y puede
incluir iPad, tablet Android, teléfono Android o, si corresponde, iPhone.
Optimizar el gate para un único modelo antes de esa decisión produciría una
evidencia incompleta y poco representativa.

La compatibilidad física no se considera fallida: queda deliberadamente
**diferida a un staging público real** con HTTPS válido. La matriz definitiva
se arma sólo con el hardware finalmente seleccionado; una plataforma no tiene
que aprobar si no forma parte del despliegue elegido.

Matriz mínima candidata:

| Plataforma | Navegador / modo |
|---|---|
| iPadOS | Safari + PWA instalada |
| Android tablet | Chrome + PWA instalada |
| Android phone | Chrome + PWA instalada |
| iPhone, si aplica | Safari + PWA instalada |

## 4. Staging público requerido

Antes de las pruebas físicas debe existir un entorno **PUBLIC STAGING**, nunca
producción, con:

- frontend admin, fichador PWA y backend;
- PostgreSQL y storage exclusivos de staging;
- dominio/subdominios reales y HTTPS público válido;
- CORS allowlist exacta y CSP enforced;
- `TRUST_PROXY_HOPS` medido en la infraestructura real;
- observabilidad habilitada y sanitizada;
- secretos exclusivos de staging, sin reutilizar producción.

La preparación y los gates técnicos permanecen documentados en
`FICHADOR_STANDALONE_PWA_PLAN.md` §31.

## 5. Matriz futura por dispositivo

Cada dispositivo seleccionado debe validar, como mínimo:

- instalación y modo standalone de la PWA;
- pairing, estado `ACTIVE` y persistencia de identidad;
- cámara, permisos, orientación, MediaPipe y performance;
- Wake Lock, background, bloqueo/desbloqueo y cierre/reapertura;
- Wi-Fi OFF/ON, shell offline, recovery y ausencia de punch falso;
- heartbeat y transición En línea/Sin conexión;
- Acceso guiado o modo kiosco equivalente;
- estabilidad prolongada;
- IN, cooldown y OUT controlados;
- fotos, storage, auditoría, idempotencia y ausencia de duplicados;
- rate limits y recuperación frente a pérdida de conectividad.

## 6. Evidencia HTTPS LAN

Se preparó técnicamente un acceso LAN con `mkcert` + Caddy, certificado para
IP/hostname, proxy HTTPS, build `cc8e4fc-ipad-pilot`, CORS y CSP estrictos.
La infraestructura respondió correctamente, pero no se instaló ni ejecutó la
prueba física en un iPad por la decisión de producto anterior.

Estado: **TECHNICALLY READY / PHYSICAL TEST DEFERRED**. Los certificados,
claves y configuración bajo `/private/tmp` fueron artefactos locales y no
forman parte del repositorio.

## 7. Gate de F13 y alcance de F14

F13 sigue significando **ROLLOUT A PRODUCCIÓN**; no se renombra ni se usa para
staging. Sólo puede comenzar cuando:

1. exista el staging público;
2. se complete F12 device compatibility;
3. se prueben los dispositivos físicos realmente seleccionados;
4. se resuelvan los blockers encontrados;
5. exista aprobación explícita para producción y migraciones.

F14 (reconocimiento facial real) permanece fuera de esta etapa y requiere su
propia definición funcional, técnica, de seguridad y legal.

## 8. Observación pendiente de storage

Durante la validación local se observó
`CLOCK_STORAGE_ORPHAN_EVIDENCE_DETECTED` con `count: 10`. Es preexistente y no
se relacionó con un punch nuevo de esta etapa. No se corrige aquí ni se toca la
DB: debe investigarse en una etapa separada antes de producción, preservando
la evidencia y siguiendo el flujo de reconciliación controlado existente.
