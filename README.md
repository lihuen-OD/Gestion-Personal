# Super Senior Full Stack Enterprise AI Kit

Kit completo para usar con Codex, Claude Code u otros asistentes de IA de desarrollo.

Este paquete combina dos capas:

1. Super Senior Full Stack Engineering
   - arquitectura
   - backend
   - frontend
   - base de datos
   - seguridad
   - testing
   - deploy
   - performance
   - code review

2. Enterprise Product Design
   - diseño SaaS profesional
   - desktop-first para sistemas empresariales
   - UI consistente
   - dashboards reales
   - componentes reutilizables
   - prevención de diseños genéricos de IA
   - prevención de errores visuales como íconos tapando textos/números

## Cómo usar

Copiar todo este paquete en la raíz de cada proyecto.

Estructura esperada:

```txt
mi-proyecto/
├── AGENTS.md
├── CLAUDE.md
├── docs/
├── skills/
├── prompts/
├── frontend/
└── backend/
```

## Qué archivos se modifican por proyecto

Modificar solamente:

```txt
docs/PROJECT_CONTEXT.md
docs/PROJECT_UI_CONTEXT.md
```

Todo lo demás queda fijo como reglas generales.

## Uso recomendado al iniciar un proyecto

Pegar en Codex o Claude Code:

```txt
Primero leé AGENTS.md, CLAUDE.md, docs/PROJECT_CONTEXT.md y docs/PROJECT_UI_CONTEXT.md.
Trabajá siguiendo las skills:
- super-senior-fullstack-engineer
- enterprise-product-designer

No modifiques código hasta entender la arquitectura, el contexto de negocio y el diseño esperado.
```

## Uso recomendado para corregir UI

Usar:

```txt
prompts/fix-global-enterprise-ui.txt
```

## Uso recomendado para crear una feature

Usar:

```txt
prompts/build-feature-senior.txt
```

## Uso recomendado para auditar seguridad

Usar:

```txt
prompts/security-audit.txt
```

## Uso recomendado para auditar diseño

Usar:

```txt
prompts/audit-ai-looking-design.txt
```
