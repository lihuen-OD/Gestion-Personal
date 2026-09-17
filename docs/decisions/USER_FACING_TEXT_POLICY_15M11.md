# Etapa 15M.11 — Texto visible orientado a personas

## Decisión

Las pantallas operativas no muestran identificadores internos, UUID, códigos de error ni enums crudos. Esos valores permanecen en contratos, persistencia y auditoría, pero la interfaz usa nombres, estados y explicaciones accionables.

Las observaciones históricas de cargas generadas desde fichadas se adaptan en presentación mediante `formatTimeEntryObservation`. Esto evita una migración destructiva y mantiene trazabilidad. Las cargas nuevas se persisten directamente con texto humano y sin el identificador del turno.

Los catálogos explícitamente técnicos pueden conservar códigos de negocio editables (por ejemplo, código Finnegans o código de concepto) porque son datos administrables, no identificadores de infraestructura. La auditoría puede conservar detalle técnico cuando sea necesario para diagnóstico, siempre separado del flujo operativo normal.

## Reglas de UI

- Mostrar nombres humanos antes que códigos.
- Traducir estados, severidades, tipos y modos mediante mapas exhaustivos.
- No interpolar `error.code`, UUID ni mensajes internos en avisos de usuario.
- Los callouts informativos deben ocupar sólo la altura de su contenido y no heredar el estiramiento de grillas vecinas.
- Las duraciones usan el formato canónico en horas y minutos.

## Cobertura aplicada

- Modal de carga horaria por legajo: observaciones históricas, aviso de Hora Especial y corrección administrativa.
- Bandeja global de horas: observaciones sanitizadas.
- Nuevas observaciones generadas por el motor de fichadas.
- Alta y edición de legajos: errores sin códigos internos.
