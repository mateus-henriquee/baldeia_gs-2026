# Arquitetura do sistema

```
baldeia/
├── apps/
│   ├── web/        React 19 + TypeScript + Vite — landing + plataforma (SPA responsiva)
│   └── api/        Node.js + Express 5 + TypeScript (tsx) — API, roteador, governança
├── pipeline/       Python — ingestão, Bronze/Silver/Gold, qualidade, análise
├── database/       migrações SQL (PostgreSQL; PostGIS opcional)
├── data/           fontes, bronze, silver, gold (versionados para a demo rodar sem Python)
├── brand/          marca (SVG/PNG) + gerador
└── docs/           documentação + diagramas (fontes editáveis)
```

## Módulos e responsabilidades

| Camada | Módulo | Arquivo(s) |
|---|---|---|
| Interface | landing, seção de ciência de dados, plataforma | `apps/web/src/landing`, `apps/web/src/app` |
| Interface | componentes: busca (combobox ARIA), mapa (Leaflet), resultados explicados, lightbox, gráficos | `apps/web/src/components` |
| Interface | navegação offline (localStorage) e GPS local | `apps/web/src/lib/trip.ts`, `app/Navigate.tsx` |
| Autenticação | cadastro, login, sessão, verificação de e-mail, papéis | `apps/api/src/modules/auth.ts` |
| Serviços de transporte | rede em memória, busca de locais, planejamento | `routing/network.ts`, `routing/planner.ts`, `modules/planning.ts`, `modules/public.ts` |
| Integrações externas | tiles OSM (cliente); GTFS via pipeline; adaptadores futuros | `components/TransitMap.tsx`, `pipeline/`, [integracoes.md](integracoes.md) |
| Banco de dados | cliente PGlite/PostgreSQL, migrações, carga Gold, demo | `apps/api/src/db` |
| Processamento de dados | Bronze/Silver/Gold | `pipeline/baldeia_pipeline` |
| Análises | descritiva (pipeline), agregados (SQL), hábitos | `analysis.py`, `modules/me.ts`, views SQL |
| Recomendações | perfis, custo generalizado, explicação | `routing/planner.ts` |
| Governança | consentimentos, auditoria, retenção, transparência, minimização de texto | `modules/consents.ts`, `modules/audit.ts`, `lib/retention.ts`, `lib/privacy.ts` |
| Comunidade | relatos, confiança, moderação | `modules/community.ts`, `community/trust.ts` |
| Monitoramento | latência, contadores, saúde | `lib/metrics.ts`, `/api/public/status` |

## Decisões e justificativas

| Escolha | Por quê | Alternativas consideradas |
|---|---|---|
| **React + TS + Vite** | ecossistema maduro, tipagem, build rápido; base para **React Native** no app mobile (lógica de `lib/` reaproveitável) | Next.js (SSR desnecessário agora) |
| **CSS próprio com tokens** | identidade original, sem aparência de template; leve | biblioteca de componentes (pesaria e padronizaria o visual) |
| **Leaflet + tiles configuráveis** | leve, acessível por teclado, sem chave de API | MapLibre (vetorial; exige provedor de tiles vetoriais) |
| **Express 5 + zod** | simples, erros assíncronos nativos, validação declarativa | NestJS (mais cerimônia), Fastify |
| **PostgreSQL** | relacional com JSONB, `CHECK`, views, PostGIS quando necessário | MongoDB (perde integridade referencial — essencial aqui) |
| **PGlite em desenvolvimento** | o *mesmo* PostgreSQL, sem instalar servidor: `npm install && npm run dev` | SQLite (SQL diferente → documentação divergente) |
| **Python + pandas no pipeline** | padrão em ciência de dados; legível para a banca | Polars (mais rápido; desnecessário no volume atual), dbt (excesso para o MVP) |
| **CSV na Silver/Gold** | auditável em qualquer editor; sem dependências extras | Parquet (recomendado ao escalar — tipos e compressão) |
| **Contrato Gold → API por arquivos + manifesto** | desacopla Python de Node; reprocessável; versionado | API Python separada (mais um serviço para operar) |
| **Grafo em memória** | consultas em ~10–20 ms na amostra | consultas SQL recursivas (lentas para isso) |
| **Sessão em cookie httpOnly** | token inacessível a JavaScript (mitiga XSS) | localStorage (exposto a XSS) |
| **Sem ML** | não há dados observados para treinar/avaliar honestamente | — ver [metodologia](metodologia-analitica.md) |

## Fluxo de uma consulta de rota

1. Usuário escolhe origem/destino (`/api/public/places`, estações agrupadas) e horário.
2. `POST /api/plan` → valida (zod) → busca relatos ativos e calcula confiança → executa Dijkstra para cada perfil disponível → deduplica → gera explicação e avisos de dados.
3. Grava `recommendations` (com `user_id` e origem/destino **apenas** se houver consentimento de histórico).
4. Interface mostra alternativas, critérios disponíveis/indisponíveis, origem de cada valor e trajeto no mapa.
5. "Iniciar navegação" → salva a viagem no aparelho; com consentimento, cria `journeys` no servidor; checkpoints sincronizam quando há conexão.

## Segurança na borda

Helmet (CSP restrita a `'self'` + tiles OSM; `Referrer-Policy` exigida pelo OSM), limite de corpo 32 kB, limites de requisição (600/15 min geral; 20/15 min em autenticação; 40/min no planejador; 2–5 relatos/h por conta), verificação de `Origin` para métodos de escrita, exigência de JSON, cookies `SameSite=Lax`.

## Evolução para app mobile

- A API já é o único ponto de acesso a dados (o front não acessa banco).
- `lib/api.ts`, `lib/trip.ts` (navegação offline), tipos e regras de explicação são independentes de DOM → reaproveitáveis em React Native.
- Necessário: autenticação por token para app nativo (cookie → header `Authorization` com refresh), notificações push para alertas, mapas nativos.

## Ambientes

| | Demonstração local (padrão) | Produção (alvo) |
|---|---|---|
| Banco | PGlite em `data/app-db` | PostgreSQL 16 + PostGIS gerenciado, backup e réplica |
| Dados demo | `SEED_DEMO=true` (rotulados) | `SEED_DEMO=false` |
| Segredo | temporário se ausente (aviso) | `JWT_SECRET` obrigatório (a API recusa iniciar sem) |
| Tiles | tile.openstreetmap.org (baixo volume) | provedor próprio/comercial (`VITE_MAP_TILE_URL`) |
| HTTPS | — | obrigatório (cookie `Secure`) |
| Front | Vite dev server com proxy | `npm run build` + Express servindo `apps/web/dist` |
