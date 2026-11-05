# Governança, ética e privacidade de dados

> Este documento descreve o que **está implementado** (marcado ✅), o que depende de **configuração de produção** (⚙️) e o que é **planejado** (🗓️). Ele segue princípios da LGPD (Lei 13.709/2018) e orientações da ANPD, mas **não constitui parecer jurídico nem certificação de conformidade**.

Diagrama: [`data-governance.svg`](../apps/web/public/assets/diagrams/data-governance.svg) — matriz de controles × etapas do ciclo de vida. Fluxo e limites de confiança: [`data-flow.svg`](../apps/web/public/assets/diagrams/data-flow.svg).

**Objetivo:** dados rastreáveis, confiáveis, usados com finalidade legítima e protegidos — sem pressupor ganho de acurácia ou capacidade preditiva.

---

## 0. Glossário de dados de negócio (linguagem comum entre produto, operação e dados)

| Termo | Definição | Sinônimos | Fonte |
|---|---|---|---|
| Parada | Local onde o passageiro embarca/desembarca (ponto de ônibus ou plataforma) | ponto, stop | GTFS `stops.txt` |
| Estação | Parada atendida por metrô/trem; homônimas próximas formam um grupo | terminal (quando aplicável) | derivado (`stops.kind`) |
| Linha | Serviço identificado ao público (ex.: Metrô L1, 2002-10) | rota, route | GTFS `routes.txt` |
| Viagem-modelo | Sequência de paradas e tempos de uma linha num sentido | trip, padrão | GTFS `trips.txt`, `stop_times.txt` |
| Intervalo (headway) | Tempo programado entre veículos da mesma linha | frequência | GTFS `frequencies.txt` |
| Baldeação | Troca de veículo/linha durante um trajeto | conexão, transferência | derivado (embarques − 1) |
| Trecho | Deslocamento entre duas paradas consecutivas de uma viagem | segmento | Gold `route_segments` |
| Trajeto/alternativa | Sequência de etapas (caminhada e transporte) entre origem e destino | rota sugerida, itinerário | planejador |
| Relato | Informação enviada por usuário sobre uma ocorrência numa parada | ocorrência comunitária, report | `community_reports` |
| Confiança do relato | Apoio comunitário × frescor (0–1); nunca equivale a "verdade" | credibilidade | `trust.ts` |
| Alerta oficial | Aviso publicado por operador/órgão (GTFS-RT Alerts) | aviso operacional | `service_alerts` (sem fonte) |
| Versão do dataset | Identificador de uma carga (hash da fonte + versão do pipeline) | release de dados | `dataset_versions` |

## 0.1 Dicionário das 3 tabelas nucleares

O dicionário completo (27 tabelas) está em [modelagem-banco-de-dados.md](modelagem-banco-de-dados.md#5-dicionário-de-dados). As três nucleares, no padrão *cadastro / eventos / transações*:

**`stops` (cadastro do ativo principal)**

| Coluna | Tipo | Descrição | Origem | Exemplo | Regra |
|---|---|---|---|---|---|
| stop_id | text | Identificador da parada | GTFS | `18849` | PK; único |
| name | text | Nome público | GTFS | `Vila Madalena` | obrigatório |
| lat / lon | double | Coordenadas WGS84 | GTFS | `-23.5465 / -46.6911` | faixas válidas; alerta se fora da RMSP |
| kind | text | estacao \| ponto | derivado | `estacao` | domínio fechado |
| dataset_version_id | text | Versão de origem | pipeline | `dsv_b944…_p1.1.0` | FK |

**`community_reports` (leituras/eventos)**

| Coluna | Tipo | Descrição | Origem | Exemplo | Regra |
|---|---|---|---|---|---|
| report_id | uuid | Identificador | sistema | `9f…` | PK |
| type | text | Tipo da ocorrência | usuário | `superlotacao` | 8 valores |
| stop_id | text | Local | usuário | `18849` | FK; linha deve atender a parada |
| description | varchar(280) | Texto livre sem dados pessoais | usuário (tratado) | "Plataforma cheia" | ≤ 280; PII removida |
| expires_at | timestamptz | Validade | regra por tipo | +45 min | > created_at |
| status | text | ativo / oculto_moderacao / removido | sistema | `ativo` | domínio fechado |

**`journeys` (transações/intervenções)**

| Coluna | Tipo | Descrição | Origem | Exemplo | Regra |
|---|---|---|---|---|---|
| journey_id | uuid | Identificador | sistema | `3c…` | PK |
| user_id | uuid | Titular | sessão | `a1…` | FK; cascata na exclusão |
| origin/destination_stop_id | text | Origem e destino | planejador | `18849 → 18872` | FKs; diferentes |
| requested_departure | timestamptz | Saída desejada | usuário | `2026-11-05 08:00-03` | obrigatório |
| planned_duration_secs | int | Duração planejada | planejador | `2640` | > 0 |
| saved_to_history | bool | Salva por consentimento | sistema | `true` | só existe com consentimento |

---

## 1. Política de qualidade

**Dimensões** (`quality_checks.dimension`): completude, validade, unicidade, consistência, atualidade, precisão.

| Escopo | Profiling | Analysis | Cleansing |
|---|---|---|---|
| ✅ GTFS (Silver) | contagem por arquivo; colunas presentes; nulos | 54 regras (ver [pipeline-de-dados.md](pipeline-de-dados.md#etapa-3--silver-tratamento-e-validação)) | dedupe, tipagem, quarentena, imputação sinalizada |
| ✅ Gold | velocidades por modo | z-score robusto (|z| > 3,5) | **não corrige**: sinaliza e avisa o usuário |
| ✅ Relatos | tipo, parada, linha, duplicidade (30 min) | confiança, denúncias | remoção de e-mail/CPF/telefone/placa; moderação |
| ✅ Banco | — | `CHECK`, `FK`, `NOT NULL`, `UNIQUE` | rejeição transacional |

**Regras de aceite:** falha em regra de *bloqueio* (arquivo ou coluna obrigatória ausente) interrompe a carga; nada muda no banco. Falhas de *quarentena* seguem com os registros válidos, e os reprovados ficam em `_quarentena/` com motivo. Toda carga gera `quality_checks` vinculados à versão — consultáveis em **/transparencia**.

## 2. Política de privacidade (resumo operacional)

| Tratamento | Finalidade | Base legal (art. 7º) | Dado | Retenção |
|---|---|---|---|---|
| Conta | acesso e segurança | V — execução de contrato | e-mail, nome de exibição, hash de senha | até exclusão |
| Histórico de viagens | consulta e repetição | I — consentimento | origem/destino (paradas), horário, duração | 180 dias |
| Análise de hábitos | sugerir horários | I — consentimento | derivado do histórico | sob demanda (não armazena) |
| Geolocalização | parada mais próxima na navegação | I — consentimento + permissão do navegador | lat/lon **no aparelho** | não armazenada |
| Publicação na comunidade | alertar outros passageiros | I — consentimento + termos | tipo, parada, texto tratado | texto: 30 dias após expirar |
| Auditoria/segurança | prevenção de abuso, responsabilização | IX — legítimo interesse (avaliar com o Guia ANPD 2024) | ação, entidade, IP em hash | 365 dias |
| Recomendações anônimas | monitorar qualidade | IX — legítimo interesse | critérios, métricas, sem identificador | 90 dias |

Texto ao usuário: página **/privacidade** e painel **/app/privacidade** (consentimentos com finalidade, base legal e retenção por item).

## 3. Classificação dos dados

| Classe | Exemplos | Controles |
|---|---|---|
| **Pública** | GTFS, traçados, catálogo de fontes, relatório de qualidade, agregados k≥3 | leitura livre pela API |
| **Interna** | métricas de latência, jobs de ingestão | sem dado pessoal; exposição controlada |
| **Pessoal** | e-mail, favoritos, consentimentos, relatos com autoria | acesso só pelo titular; exportável; excluível |
| **Pessoal sensível ao contexto** | histórico de deslocamento, hábitos | opt-in; nunca público; retenção curta; sem compartilhamento |
| **Restrita (segredo)** | hash de senha, `JWT_SECRET`, tokens de verificação (hash) | nunca exportados; `.env` fora do Git |

> Localização e rotina de deslocamento não são "dados sensíveis" no rol do art. 5º, II, mas permitem inferir endereço, trabalho, religião ou saúde. Por isso recebem tratamento equivalente.

## 4. Linhagem e rastreabilidade (catálogo versionado)

`fonte (data_sources)` → `job (ingestion_jobs, SHA-256, bronze_path)` → `versão (dataset_versions + manifest)` → `regras (quality_checks)` → **toda linha da rede carrega `dataset_version_id`** → `recomendação/viagem` registra a versão usada → interface exibe a versão.
Variáveis derivadas documentadas: `kind`, `mode`, `name_search`, `travel_secs`, `distance_m`, `speed_kmh`, `robust_z`, `anomaly`, `imputed`, `walk_secs` (fórmulas em [pipeline-de-dados.md](pipeline-de-dados.md)).

## 5. Controle de acesso

**Aplicação (✅ implementado):**

| Papel | Pode | Não pode |
|---|---|---|
| Visitante | ver landing, rede, transparência, planejar (sem salvar) | publicar, votar |
| Usuário | tudo acima + favoritos, histórico (opt-in), relatos, votos, denúncias, exportar/excluir seus dados | ver dados de outros |
| Moderador | fila de denúncias; restaurar/remover com justificativa (auditado) | ver identidade dos autores |
| Admin | reservado (mesmos poderes de moderação) | — |

**Plataforma de dados (RBAC organizacional — 🗓️ a aplicar ao sair do ambiente local):**

| Papel | Bronze | Silver | Gold/banco | Dados pessoais | Auditoria |
|---|---|---|---|---|---|
| Engenheiro(a) de Dados | leitura/escrita | leitura/escrita | escrita (carga) | não | leitura |
| Analista de Dados | — | leitura | leitura (views agregadas) | **não** (só agregados k≥3) | — |
| Gestor(a) de Produto | — | — | painéis agregados | não | — |
| Auditor(a) | leitura | leitura | leitura | por amostragem, com registro | leitura |

Princípio do **mínimo privilégio**. Em PostgreSQL de produção: um *role* por papel, `GRANT` por schema, e a API usando um *role* sem permissão de DDL.

## 6. Política de retenção (✅ `apps/api/src/lib/retention.ts`, na inicialização e a cada 6 h)

| Dado | Prazo | Ação |
|---|---|---|
| Viagens e etapas | 180 dias | exclusão |
| Texto de relatos | 30 dias após expirar | `description = NULL` (tipo/parada/hora ficam para agregados) |
| Recomendações anônimas | 90 dias | exclusão |
| Logs de auditoria | 365 dias | exclusão |
| Histórico ao revogar consentimento | imediato | exclusão + desvinculação das recomendações |
| Conta excluída | imediato | cascata; relatos ficam sem autoria |
| Bronze | enquanto necessário para reprocessar | 🗓️ política por fonte (ex.: 90 dias) |

Execuções que apagam algo são registradas em `audit_logs`.

## 7. Riscos éticos

| # | Risco | Como pode acontecer aqui |
|---|---|---|
| R1 | Coleta excessiva | guardar GPS contínuo, endereço de casa, rotina completa |
| R2 | Monitoramento indevido | uso do histórico para vigiar alguém; vazamento |
| R3 | Discriminação territorial | ranquear bairros como "perigosos" a partir de relatos |
| R4 | Viés nas recomendações | penalizar regiões com mais usuários reportando; ignorar regiões com menos dados |
| R5 | Desigualdade de dados | periferias com GTFS pior, menos relatos, menos conectividade |
| R6 | Desinformação | relatos falsos, brigadas de confirmação, pânico |
| R7 | Exposição de localização | relato revela onde o autor está; texto com dados de terceiros |
| R8 | Inferências indevidas | deduzir trabalho, religião ou saúde por padrões de deslocamento |
| R9 | Dependência de algoritmo | confiar cegamente em "rota mais rápida" com dados históricos |
| R10 | Falsa sensação de segurança | "menos ocorrências" lido como "seguro" |
| R11 | Dados incorretos do operador | trecho com tempo implausível (caso real: 130 km/h na L11) |

## 8. Mitigações concretas

| Risco | Medida | Estado |
|---|---|---|
| R1, R7 | GPS processado no aparelho; servidor recebe só "parada confirmada"; favoritos = estação; relato = parada | ✅ |
| R1, R8 | histórico e hábitos opt-in e separados; análise só para o próprio titular; sem perfil compartilhado | ✅ |
| R2 | sessão httpOnly; histórico nunca público; exportação/exclusão; auditoria | ✅ |
| R3, R10 | **sem índice de segurança**; sem mapa de calor de crimes; "assalto/situação suspeita" expira em 2 h, só na parada; perfil "menos ocorrências reportadas" com aviso explícito | ✅ |
| R4, R5 | critério sem dados = "sem dados suficientes" (não vira nota); ausência de relato ≠ ausência de problema (aviso na interface); pesos iguais em qualquer região | ✅ |
| R5 | caminhada a 1,1 m/s (inclui pessoas mais lentas); interface responsiva, leve, offline | ✅ |
| R6 | confirmações com retorno decrescente (√n) e **teto de 85%**; contestação pesa igual; contas não verificadas com peso 0,5 e limite menor; 1 voto por pessoa; anti-duplicidade; 3 denúncias ocultam; moderação humana com justificativa; reputação bayesiana | ✅ |
| R7 | remoção automática de e-mail, CPF, telefone e placas; orientação no formulário; nome do autor nunca exibido | ✅ |
| R9, R11 | aviso de GTFS histórico em toda rota; anomalias do feed sinalizadas ao usuário; fatores e origem de cada valor visíveis | ✅ |
| Todos | atributos pessoais sensíveis **não são coletados** nem usados no roteamento (inclusive deficiência: oferecemos "preferir menos caminhada" em vez de perguntar condição de saúde) | ✅ |

**Usos vedados:** vigilância ou punição individual; venda/compartilhamento de dados pessoais; perfilamento de bairros por criminalidade; publicidade direcionada por rotina; decisões automatizadas com efeito jurídico sobre o usuário.

### Análise de erros (solução sem modelo preditivo — caso "b" do enunciado)
- **Dados incorretos:** feed desatualizado → aviso permanente; tempo implausível → sinalização. Mitigação adicional 🗓️: comparar com Olho Vivo.
- **Vieses na coleta:** relatos concentram-se onde há mais usuários → nunca convertidos em ranking territorial; agregados exigem k≥3.
- **Vieses no tratamento:** imputações sempre marcadas (`imputed`), nunca silenciosas.
- **Falso positivo** de relato (alerta inexistente): custo = desvio desnecessário → expiração curta, contestação, teto de confiança.
- **Falso negativo** (problema não reportado): risco de o usuário cair nele → a interface explica que ausência de relato não é garantia.

## 9. Aplicação dos princípios da LGPD (art. 6º)

| Princípio | Como aparece no sistema |
|---|---|
| Finalidade | consentimento por finalidade específica; descrição por item no painel |
| Adequação | dados usados só para a finalidade informada (ex.: hábitos só para o próprio titular) |
| Necessidade | parada em vez de endereço; GPS local; recomendações anônimas sem consentimento |
| Livre acesso | exportação JSON completa (`/api/me/export`) |
| Qualidade dos dados | regras de qualidade, versões, avisos de dados históricos |
| Transparência | página /transparencia; selo de origem em cada informação; política em linguagem simples |
| Segurança | bcrypt, JWT httpOnly + SameSite, CSP, limites de requisição, verificação de origem, validação (zod), auditoria |
| Prevenção | retenção automática; remoção de PII; moderação |
| Não discriminação | sem índice de segurança; sem atributos sensíveis; mesmos pesos para todos |
| Responsabilização | `audit_logs`; consentimentos append-only; documentação versionada |

Direitos do titular (art. 18): acesso e portabilidade (exportar), correção (preferências/favoritos), eliminação (excluir conta), revogação do consentimento (painel), informação sobre compartilhamento (não há). Referências: Guia de Segurança para Agentes de Pequeno Porte (ANPD, 2021); Guia sobre Legítimo Interesse (ANPD, 2024); consulta pública do Guia de Anonimização e Pseudonimização (ANPD, 2024) — orienta que hash/criptografia são **pseudonimização**, não anonimização.

## 10. Segurança da informação — tríade CID

| Pilar | Controle | Estado |
|---|---|---|
| **Confidencialidade** | senhas com bcrypt; sessão JWT em cookie httpOnly, SameSite=Lax, Secure quando HTTPS_ONLY=true (produção com HTTPS); papéis; verificação de origem (CSRF); CSP via Helmet; IP gravado só como hash; segredos em `.env` | ✅ |
| | TLS 1.2+ em trânsito; criptografia em repouso (ex.: AES-256 no volume do banco) | ⚙️ produção |
| | isolamento de ambientes (dev/demo × produção; `SEED_DEMO=false`) | ⚙️ |
| **Integridade** | `CHECK`/FK/UNIQUE; cargas em transação; SHA-256 da fonte; consentimentos append-only; trilha de auditoria; validação de entrada com zod; limite de 32 kB por requisição | ✅ |
| **Disponibilidade** | limites de requisição (global, login, planejamento, publicação); grafo em memória; `/api/public/health` e `/status` (p50/p95) | ✅ |
| | backup redundante (ex.: `pg_dump` diário + réplica); monitoramento com alerta | ⚙️/🗓️ |

**Resposta a incidentes (🗓️):** identificar e conter → revogar sessões (`token_version`) e trocar `JWT_SECRET` → avaliar risco aos titulares → comunicar ANPD e titulares quando houver risco ou dano relevante (art. 48) → registrar lições.

## 11. Políticas e padrões operacionais

1. **Nomenclatura:** tabelas e colunas em `snake_case`, singular de domínio no plural de tabela (`community_reports`); identificadores GTFS preservados; datas ISO 8601 (`AAAA-MM-DD`, `timestamptz` em UTC); arquivos brutos em `data/bronze/<fonte>/job_<AAAAMMDDTHHMMSSZ>_<sha8>/`; versões `dsv_<sha12>_p<versão do pipeline>`.
2. **Qualidade e integridade:** validação de faixas e domínios na ingestão (Silver) e no banco (`CHECK`); integridade referencial; rejeição de cargas que falham regras de bloqueio; quarentena com motivo.
3. **Rastreabilidade e linhagem:** catálogo versionado (`data_sources`, `dataset_versions`), logs de ETL (`ingestion_jobs`, `_manifest.json` com duração por etapa), variáveis derivadas documentadas.
4. **Acesso e proteção (LGPD):** mínimo privilégio; pseudonimização (IP em hash; autoria removida na exclusão); agregados com k≥3; nenhum dado pessoal na camada analítica.

## 12. Responsabilidades

| Responsável | Atribuição |
|---|---|
| Controlador (equipe do projeto) | decide finalidades; mantém esta política |
| Encarregado(a) (a nomear antes de uso público) | canal com titulares e ANPD |
| Engenharia de dados | pipeline, qualidade, linhagem, cargas |
| Moderação | decisões sobre relatos, com justificativa |
| Desenvolvimento | segurança da aplicação, retenção, testes |

## 13. Conclusão

A governança padroniza e dá linhagem confiável (cada dado tem fonte, versão e regras aplicadas); a ética impede desvios de finalidade (sem índice de segurança, sem perfil territorial, sem uso de atributos sensíveis); a segurança protege o ativo (CID). Juntos reduzem riscos e sustentam o uso responsável dos dados — **sem prometer acurácia que os dados atuais não permitem medir**.
