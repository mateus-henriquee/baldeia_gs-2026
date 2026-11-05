<p align="center"><img src="brand/baldeia-horizontal.png" alt="Baldeia" width="360"></p>

# Baldeia — mobilidade urbana orientada por dados

Plataforma que compara trajetos de ônibus, metrô e trem e **explica cada recomendação** — tempo, baldeações, caminhada e relatos da comunidade —, mostrando a origem de cada informação. Projeto acadêmico de Ciência de Dados (CitizenTech · Global Solution 2026), região-piloto São Paulo.

> **Importante:** a rede de transporte usada é uma **amostra real e histórica** do GTFS da SPTrans (calendário até 01/05/2020). Relatos e históricos de demonstração são **sintéticos** e rotulados. Não use para decidir viagens reais.

---

## 1. O que foi entregue

| Item | Onde | Estado |
|---|---|---|
| Site responsivo | `apps/web` | ✅ |
| Landing page comercial (hero, proposta, problema/solução, demo interativa, funcionalidades, ciência de dados A–F, governança, idealizadores, CTA, rodapé) | `apps/web/src/landing` | ✅ |
| Área autenticada (planejador + mapa, navegação passo a passo com modo offline/manual e GPS local, comunidade, favoritos, histórico, relatórios de hábitos, privacidade, moderação) | `apps/web/src/app` | ✅ |
| API (auth, planejamento multicritério, comunidade com confiança, LGPD, transparência, monitoramento) | `apps/api` | ✅ |
| Banco de dados (27 tabelas, 2 views) | `database/migrations` | ✅ PostgreSQL/PGlite · PostGIS opcional (não testado) |
| Pipeline Bronze → Silver → Gold com qualidade e linhagem | `pipeline/` | ✅ executado sobre dados reais |
| Diagramas (pipeline, DFD, ERD gerado do SQL, governança) SVG + PNG + fontes | `apps/web/public/assets/diagrams`, `docs/diagrams` | ✅ |
| Marca (3 nomes, logotipo, versões, paleta, tipografia) | `brand/`, `docs/identidade-visual.md` | ✅ |
| Documentação científica e técnica | `docs/` | ✅ |
| Testes | `pipeline/tests` (7), `apps/api/test` (21), `apps/web/test` (3) | ✅ |

## 2. Estrutura de pastas

```
baldeia/
├── apps/
│   ├── api/                 Node.js + Express 5 + TypeScript
│   │   ├── src/
│   │   │   ├── community/   regras de confiança dos relatos
│   │   │   ├── db/          cliente PGlite/Postgres, migrações, carga Gold, demo
│   │   │   ├── lib/         http, privacidade (PII), métricas, retenção, tempo
│   │   │   ├── modules/     auth, planning, community, me (LGPD), public, consents, audit
│   │   │   └── routing/     grafo da rede + planejador (Dijkstra multicritério)
│   │   └── test/
│   └── web/                 React 19 + TypeScript + Vite
│       ├── public/          marca, favicon, diagramas (SVG/PNG)
│       └── src/             landing/, app/, pages/, components/, lib/, styles/, content/
├── pipeline/                Python: baldeia_pipeline/ (bronze, silver, gold, analysis, run) + tests/
├── database/migrations/     001_schema.sql · 002_postgis_optional.sql
├── data/
│   ├── sources/             catalog.json (fontes) + amostra GTFS SPTrans
│   ├── bronze/ silver/ gold/  saídas do pipeline (versionadas para a demo rodar sem Python)
│   └── app-db/              banco embutido (criado ao rodar; ignorado pelo Git)
├── brand/                   logotipos + gerador
└── docs/                    documentação + diagrams/ (fontes editáveis)
```

## 3. Tecnologias

| Camada | Tecnologia | Por quê |
|---|---|---|
| Front-end | React 19, TypeScript, Vite 8, React Router 7, Leaflet, Poppins (local) | SPA responsiva, base para app mobile (React Native) |
| Back-end | Node.js ≥ 20, Express 5, zod, bcryptjs, jsonwebtoken, helmet, express-rate-limit | simples, seguro, validado |
| Banco | PostgreSQL 16 via **PGlite** (embutido) ou servidor externo; PostGIS opcional | integridade relacional sem instalar nada |
| Dados | Python 3.11+, pandas, NumPy, pytest | padrão de ciência de dados |
| Diagramas/marca | Python (gerador SVG), fontTools, librsvg | imagens reproduzíveis a partir do código |

Detalhes: [docs/arquitetura-do-sistema.md](docs/arquitetura-do-sistema.md).

## 4. Instalação (VS Code)

Pré-requisitos: **Node.js 20+** (recomendado 22), **npm**, **Git**. Python 3.11+ só é necessário para rodar o pipeline/diagramas — a Gold já vem pronta.

```bash
git clone <seu-repositorio> baldeia    # ou extraia o .zip
cd baldeia
code .                                 # abre no VS Code (aceite as extensões recomendadas)
npm install                            # instala API e web (workspaces)
cp .env.example .env                   # Windows (PowerShell): Copy-Item .env.example .env
```

Opcional — pipeline e diagramas:

```bash
python -m pip install -r pipeline/requirements.txt     # macOS/Linux pode exigir "python3"
```

## 5. Variáveis de ambiente

Tudo em [`.env.example`](.env.example). As essenciais:

| Variável | Padrão | Observação |
|---|---|---|
| `JWT_SECRET` | vazio | em dev, gera um temporário; **obrigatório em produção**. Gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DATABASE_URL` | vazio | vazio = PGlite em `data/app-db`; preencha para PostgreSQL externo |
| `SEED_DEMO` | `true` | cria contas e relatos **sintéticos** rotulados |
| `VITE_MAP_TILE_URL` | tiles OSM | em produção, use provedor próprio/comercial (política de uso do OSM) |

Nenhuma chave de API externa é necessária para rodar. Integrações futuras (token Olho Vivo etc.) ficam só no `.env` — veja [docs/integracoes.md](docs/integracoes.md).

## 6. Executar localmente

```bash
npm run dev          # API em http://localhost:3333 + site em http://localhost:5173
```

Na primeira execução a API cria o banco, aplica migrações, carrega a Gold e (com `SEED_DEMO=true`) os dados de demonstração.

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm test` | testes da API (21) e do front (3) |
| `npm run pipeline:test` | testes do pipeline (7) |
| `npm run pipeline` | reprocessa Bronze → Silver → Gold a partir do GTFS |
| `npm run diagrams` | regenera os 4 diagramas e o dicionário de dados |
| `npm run brand` | regenera os arquivos da marca |
| `npm run typecheck` | checagem de tipos (API e web) |
| `npm run build && NODE_ENV=production JWT_SECRET=... npm start` | produção: a API serve o site compilado em :3333 |
| `npm run db:reset` | apaga o banco embutido (recriado no próximo `dev`) |
| `docker compose up -d` | (opcional) PostgreSQL + PostGIS; depois defina `DATABASE_URL` |

## 7. Como testar as funcionalidades

**Contas de demonstração** (somente com `SEED_DEMO=true`, ambiente local):
- Usuário: `demo@baldeia.dev` / `baldeia-demo-2026`
- Moderação: `moderacao@baldeia.dev` / `baldeia-mod-2026`

Roteiro sugerido:
1. **Landing** → seção *Demonstração*: compare Santo Amaro → Sé às 08:00. Veja critérios disponíveis/indisponíveis, o aviso de GTFS histórico e o "Por que esta opção?".
2. **Ciência de dados (A–F)**: clique nas etapas do pipeline; amplie ERD/DFD/governança; mexa nos pesos em "D" e veja a ordem das rotas mudar.
3. **Entrar** com a conta demo → **Planejar**: escolha origem/destino (ou clique em estações no mapa), ajuste dia/hora e modos (ex.: só ônibus). Use horário entre 5h e 23h — de madrugada não há serviço programado e o sistema diz isso.
4. **Iniciar navegação** → confirme paradas com "Cheguei". Desligue a rede do navegador (DevTools → Offline): as instruções continuam; checkpoints sincronizam ao voltar. "Usar GPS" pede permissão e compara a posição **no aparelho** (fora do centro de SP ele avisa e sugere o modo manual).
5. **Comunidade**: publique um relato (na primeira vez, aceite as regras), tente incluir um telefone no texto (é removido), confirme/conteste relatos de outros. Contas novas não verificadas têm limite menor.
6. **Moderação**: crie 3 contas e denuncie o mesmo relato → ele some da lista; entre como moderação e decida com justificativa.
7. **Relatórios**: "Gerar histórico de demonstração" e veja horários habituais, variação de duração e relatos por hora (k-anonimato).
8. **Privacidade**: revogue "Salvar histórico" (apaga as viagens), baixe seus dados (JSON), exclua a conta (relatos ficam sem autoria).
9. **/transparencia**: fontes, versão ativa, 54 regras de qualidade e seus resultados.

## 8. Ciência de dados — resumo

- **Fontes pesquisadas:** 14 (oficiais, geográficas, comunitárias, comportamentais, demonstrativas), com estado real — [docs/pesquisa-fontes-de-dados.md](docs/pesquisa-fontes-de-dados.md).
- **Pipeline:** ingestão com SHA-256 → Bronze imutável → Silver com 54 regras e quarentena → Gold (824 trechos, 2.416 conexões a pé, 36 traçados) → análise → banco versionado — [docs/pipeline-de-dados.md](docs/pipeline-de-dados.md).
- **Achados reais:** calendário expirado (aviso em toda rota); 19 trechos com velocidade atípica, incluindo CPTM L11 Tatuapé–Dom Bosco a 130,9 km/h no feed (sinalizado ao usuário).
- **Métodos:** estatística descritiva robusta, z-score modificado, Dijkstra multicritério dependente do horário com 5 perfis explicados; **sem ML** por falta de dados observados — [docs/metodologia-analitica.md](docs/metodologia-analitica.md).
- **Governança/LGPD:** [docs/governanca-e-etica.md](docs/governanca-e-etica.md) · **Modelo de dados:** [docs/modelagem-banco-de-dados.md](docs/modelagem-banco-de-dados.md) · **Referências:** [docs/referencial-teorico.md](docs/referencial-teorico.md).

## 9. Limitações (honestas)

- **Dados históricos e recortados:** 19 linhas do centro de SP, programação até 2020. Nada é "tempo real".
- **Lotação:** não existe fonte oficial integrada; o critério usa só relatos comunitários e some quando não há relatos.
- **Alertas oficiais:** nenhum feed GTFS Realtime público identificado; a interface mostra "nenhuma fonte oficial integrada".
- **Espera** é estimada como metade do intervalo programado (premissa declarada).
- **Endereços:** busca por estação/ponto; não há geocodificação de endereços (decisão também de privacidade).
- **Fotos de estações e estabelecimentos próximos:** sem fonte com direito de uso integrada — a interface declara isso.
- **E-mail:** sem servidor de envio; o link de verificação aparece na tela/terminal em desenvolvimento.
- **PostGIS:** migração pronta, **não testada** neste ambiente.
- **Mapa:** tiles públicos do OSM servem para baixo volume; produção exige outro provedor.
- **Escala:** roteador validado na amostra (~10–20 ms/consulta); para o GTFS completo, recomenda-se RAPTOR.
- **Idealizadores:** perfis com placeholders — os links de Instagram do enunciado não foram fornecidos, então nada foi inventado. Edite `apps/web/src/content/content.ts`.
- **Marca:** disponibilidade comercial do nome **não verificada** no INPI.
- **Conformidade:** as medidas seguem a LGPD, mas não são certificação jurídica.

## 10. Próximos passos técnicos

1. Cadastrar na área do desenvolvedor SPTrans e processar o GTFS completo (passo a passo em `docs/integracoes.md`).
2. Integrar Olho Vivo (previsão de chegada) com coletor → Bronze → Silver.
3. Migrar o roteador para RAPTOR e medir latência com o feed completo.
4. Agendar ingestão (cron) e alertar quando a fonte ficar velha.
5. Envio real de e-mail de verificação; recuperação de senha.
6. Testes end-to-end (Playwright) e de acessibilidade automatizados (axe).
7. Indicadores mensais do Metrô como contexto de movimento por estação.
8. App mobile (React Native) reutilizando `lib/` e a API; autenticação por token.

## 11. Sugestões de melhoria (aguardando sua aprovação — **não implementadas**)

| Sugestão | Problema que resolve | Benefício | Impacto técnico |
|---|---|---|---|
| **PWA com service worker** | site não abre sem internet se a aba for fechada | navegação offline real, "instalar no celular" | médio: manifest + cache de assets/rede; atenção a dados pessoais em cache |
| **Seção ODS na landing** (ODS 11, 9, 10) | o enunciado da GS pede ODS no pitch | alinha site e apresentação | baixo: conteúdo estático |
| **Acessibilidade em rotas** (elevadores/escadas por estação via GeoSampa/OSM) | pessoas com mobilidade reduzida | critério novo e relevante (CitizenTech) | médio/alto: nova fonte, novo perfil, sem perguntar condição de saúde |
| **Exportar Gold em Parquet** | CSV perde tipos e cresce com o feed completo | desempenho e tipagem | baixo: `pyarrow` + ajuste do loader |
| **Painel interno de qualidade ao longo do tempo** | hoje só vemos a versão ativa | acompanhar regressões de dados | médio: série de `quality_checks` + gráficos |

## 12. Créditos e licenças de dados

- Rede: GTFS SPTrans (amostra) via r5py/Ipea — uso aberto segundo o r5py; ver `data/sources/sptrans-gtfs-amostra/FONTE.md`.
- Mapa: © OpenStreetMap contributors, ODbL.
- Fonte tipográfica: Poppins (SIL OFL).
