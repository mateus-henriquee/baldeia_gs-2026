# Metodologia analítica

Princípio: **começar por estatística descritiva e regras transparentes**; usar Machine Learning só quando houver dados observados suficientes, problema bem definido e avaliação válida. Nesta versão **não há modelo de ML** — e explicamos por quê.

## 1. Avaliação dos métodos

| Método | Aplicação no projeto | Variáveis de entrada | Resultado esperado | Estado | Limitações |
|---|---|---|---|---|---|
| **EDA** | perfil da rede e da oferta | GTFS (trechos, frequências) | distribuições, picos de oferta, anomalias | **Implementado** (`analysis.py`) | oferta planejada ≠ operação |
| **Estatística descritiva** | velocidades, durações, hábitos | trechos; viagens do usuário | média, mediana, quartis, desvio-padrão | **Implementado** | amostra pequena por usuário |
| **Séries temporais** | movimento e duração ao longo do tempo | relatos/hora; tempos observados | sazonalidade diária/semanal | **Parcial**: agregação por hora; sem modelo | sem série observada longa |
| **Detecção de anomalias** | qualidade do feed; picos de relatos | velocidade por trecho; contagem/hora | trechos e períodos atípicos | **Implementado** para o feed (z robusto) | depende de limiar; requer revisão humana |
| **Recomendação** | escolher entre trajetos | tempo, espera, caminhada, baldeações, relatos, preferências | alternativas explicadas | **Implementado** (multicritério com pesos) | pesos são escolhas de projeto, não aprendidos |
| **Modelos preditivos** | atraso, duração, lotação | posições de veículos (AVL), histórico de tempos | previsão com intervalo | **Não implementado** | **não há dados observados**; ver §5 |

## 2. Estatística descritiva e EDA (implementado)

- **Velocidade por trecho** = distância haversine ÷ tempo programado. Resumo por modo: n, média, mediana, p25, p75, IQR, desvio-padrão, mínimo, máximo.
- **Oferta por hora**: expande cada janela de `frequencies.txt` nas horas cobertas; por modo, conta linhas-sentido ativas e calcula o intervalo mediano. Base: serviços que operam às quartas-feiras.
- **Duração por viagem-modelo**: soma dos trechos; extensão e velocidade média.
- **Hábitos** (por usuário, com consentimento): horário de saída por destino (mediana e quartis — robustos a outliers); viagens e duração média por dia da semana; média e desvio-padrão da duração planejada. Exige **n ≥ 5** viagens; destinos com < 3 viagens não são resumidos.

## 3. Detecção de anomalias (implementado)

**Z-score modificado** (Iglewicz & Hoaglin, 1993): `z = 0,6745 · (x − mediana) / MAD`, por modo. Limiar |z| > 3,5.
Escolhido porque mediana e MAD não são distorcidas pelos próprios outliers (o z-score clássico seria).
Resultado: 19 de 824 trechos sinalizados; o caso extremo (CPTM L11 Tatuapé–Dom Bosco, 130,9 km/h) é **erro plausível do feed** (trecho expresso sem paradas intermediárias com tempo subestimado). Os trechos são mantidos, marcados, e o planejador avisa ao usá-los.

## 4. Inteligência das rotas (implementado)

### Modelagem como grafo
- **Nós:** paradas e estações (654). Estações homônimas próximas formam grupos de origem/destino.
- **Arestas de transporte:** para cada *padrão de viagem* (linha + sentido + sequência de paradas), uma aresta de cada parada *i* para cada parada seguinte *j* (embarque em *i*, desembarque em *j*). Custo de tempo = espera ao embarcar + tempo no veículo (`arr[j] − dep[i]`).
- **Arestas a pé:** `stop_transfers` (≤ 400 m em linha reta, limitado pela preferência do usuário). Não se encadeiam duas caminhadas seguidas.

### Dependência do horário
- **Serviço por frequência:** se o instante *t* está dentro de uma janela, espera esperada = **intervalo ÷ 2** (premissa de chegadas aleatórias do passageiro); se antes da janela, espera até a primeira passagem.
- **Serviço por horário fixo:** busca binária da próxima partida programada.
- Dia da semana define os serviços ativos (`calendar`). Esperas > 2 h descartam a aresta.

### Algoritmo
**Dijkstra** com fila de prioridade (heap binário) sobre o custo generalizado, com rótulos dependentes do tempo; limite de 4 embarques. Complexidade O((V + E) log V) por perfil. Na amostra, ~10–20 ms por consulta com 5 perfis.

### Custo generalizado (segundos-equivalentes)
`C = a·viagem + b·espera + c·caminhada + d·embarques + e·lotação + f·ocorrências`

| Perfil | a | b | c | d (s/embarque) | e | f | Requer |
|---|---|---|---|---|---|---|---|
| Mais rápida | 1 | 1 | 1 | 90 | 0 | 0 | — |
| Menos baldeações | 1 | 1 | 1 | 1200 | 0 | 0 | — |
| Menos caminhada | 1 | 1 | 3 | 240 | 0 | 0 | — |
| Potencialmente menos movimentada | 1 | 1 | 1 | 120 | 1200 | 0 | relatos de superlotação ativos |
| Menos ocorrências reportadas | 1 | 1 | 1 | 120 | 0 | 1200 | relatos ativos |

- `lotação` = maior confiança entre relatos de superlotação na parada de embarque (e linha, se informada).
- `ocorrências` = soma, por parada percorrida, da maior confiança de relatos não-lotação.
- Relatos com confiança < 0,15 são ignorados.
- Os pesos são **decisões de projeto declaradas**, não parâmetros aprendidos. A seção "D" do site permite variá-los e ver a ordem mudar.

### Tratamento de critérios sem dados
Cada resposta traz `criterios` com `disponivel` e `fonte`/`motivo`. Se não há relatos de lotação, o perfil "menos movimentada" **não é calculado** e a interface explica. "Segurança" e "tempo real" aparecem sempre como **não disponíveis**.

### Por que menor tempo ≠ menor lotação ≠ "mais seguro"
São perfis distintos. Não existe índice de segurança: relatos não medem risco e refletem onde há mais usuários reportando (viés de cobertura).

### Exemplo real (amostra, quinta 08:00, com relatos sintéticos)
Santo Amaro → Sé: **48 min** com 2 baldeações (CPTM L9 → Metrô L4 → Metrô L1, 1 relato no trajeto) × **50 min** com 1 baldeação (L5 → L1, sem relatos). O sistema mostra as duas e explica a troca: +2 min por uma baldeação a menos e nenhum relato.

### Alternativas avaliadas
- **RAPTOR** (Delling et al., 2015): rodadas por baldeação, Pareto em chegada × baldeações, eficiente em redes grandes — **recomendado** ao integrar o GTFS completo.
- **CSA** (Dibbelt et al., 2018): varredura de conexões ordenadas — excelente para horários fixos; menos natural para serviço por frequência, que domina a amostra.
- **A\***: heurística geográfica ajuda pouco quando o custo inclui espera e penalidades.

## 5. Modelos preditivos — avaliação (não implementado)

| Pergunta | Alvo | Dados necessários | Baseline | Métricas | Validação | Situação |
|---|---|---|---|---|---|---|
| Atraso na chegada | atraso (min) | posições (Olho Vivo/AVL) + horários | média histórica por linha × hora | MAE, RMSE, cobertura de intervalo | divisão **temporal** (treino passado, teste futuro) | sem dados observados |
| Duração da viagem | tempo porta-a-porta | viagens concluídas com checkpoints | tempo programado (GTFS) | MAE, viés | divisão temporal, por usuário | dados insuficientes |
| Movimento por estação/hora | relatos/hora ou entradas | Metrô (mensal) + relatos | média sazonal | MAE, Poisson deviance | divisão temporal | relatos sintéticos não servem |

**Por que não treinar agora:** os únicos dados de "comportamento" disponíveis são **sintéticos**. Treinar com eles e reportar métricas seria apresentar estimativa como resultado experimental. Nenhum resultado de modelo é reportado neste projeto.

## 6. Avaliação do sistema de recomendação (como será feita)
- Online: taxa de "útil", alternativa escolhida vs. 1ª sugerida, abandono de navegação.
- Offline (com dados reais): comparar duração prevista × observada por checkpoints; calibração da confiança dos relatos contra alertas oficiais quando houver fonte.
- Equidade: comparar disponibilidade de critérios e qualidade por região (ver governança §7).
