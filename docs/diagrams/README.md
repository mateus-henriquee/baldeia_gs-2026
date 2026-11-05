# Diagramas

| Diagrama | Imagem (SVG/PNG) | Fonte editável |
|---|---|---|
| Pipeline de dados | `apps/web/public/assets/diagrams/data-pipeline.svg` | `build_diagrams.py` (`pipeline()`), `data-pipeline.mmd` |
| Fluxo de dados (DFD) | `.../data-flow.svg` | `build_diagrams.py` (`dfd()`), `data-flow.mmd` |
| Entidade-relacionamento | `.../entity-relationship.svg` | **gerado de `database/migrations/001_schema.sql`**; resumo em `entity-relationship.mmd` |
| Governança e linhagem | `.../data-governance.svg` | `build_diagrams.py` (`governance()`), `data-governance.mmd` |

Atualizar após mudar código, schema ou pipeline:

```bash
npm run diagrams          # SVG + PNG + dicionário de dados em docs/modelagem-banco-de-dados.md
```

Requisitos: Python 3.11+; `rsvg-convert` (librsvg) para PNG — opcional. O ERD falha de propósito se uma tabela nova não tiver posição definida em `ERD_LAYOUT`, para o diagrama nunca ficar desatualizado em silêncio. Os `.mmd` podem ser abertos em https://mermaid.live ou na extensão Mermaid do VS Code.
