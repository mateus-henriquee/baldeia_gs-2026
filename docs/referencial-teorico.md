# Referencial teórico

Data de consulta de todas as URLs: **05/11/2026**. Referências marcadas com † foram identificadas por busca, mas a página específica não pôde ser aberta a partir do ambiente de desenvolvimento — confira antes de citar formalmente. Nenhuma referência foi inventada; obras clássicas citadas sem URL são de amplo conhecimento e devem ser verificadas na biblioteca.

## 1. Dados de transporte público

**Conceito.** O GTFS (General Transit Feed Specification) é uma especificação aberta para descrever redes de transporte: o *GTFS Schedule* traz programação, paradas e traçados em CSVs compactados; o *GTFS Realtime* complementa com atualizações de viagem, posições de veículos e alertas, em Protocol Buffers.
**Aplicação.** Todo o pipeline lê GTFS; o banco espelha suas entidades; a tabela `service_alerts` e o critério de lotação foram desenhados para GTFS-RT (`occupancy_status`).
**Justificativa.** Padrão de fato, adotado pela SPTrans, EMTU e por catálogos como a Mobility Database — permite trocar a fonte sem reescrever o sistema.

- MobilityData / comunidade GTFS. *GTFS Schedule Reference*. https://gtfs.org/schedule/reference/ †
- MobilityData / comunidade GTFS. *GTFS Realtime Reference*. https://gtfs.org/realtime/ †
- Google/MobilityData. `gtfs-realtime.proto` (histórico de alterações em `OccupancyStatus`). https://github.com/google/transit
- Pereira, R. H. M.; Herszenhut, D. *Introdução à Acessibilidade Urbana: um guia prático em R*, cap. 4 "Dados GTFS". Ipea, 2023. https://ipeagit.github.io/intro_access_book/4_dados_gtfs.en.html — usa recorte do GTFS da SPTrans (out./2019).
- SPTrans. Área do desenvolvedor (GTFS e API Olho Vivo). https://www.sptrans.com.br/desenvolvedores/ †
- r5py. *Sample data: São Paulo*. https://github.com/r5py/r5py.sampledata.sao_paulo
- MobilityData. *Mobility Database*. https://mobilitydatabase.org

## 2. Dados geográficos

**Conceito.** Dados abertos colaborativos (OpenStreetMap, licença ODbL) e cálculo de distâncias na esfera (fórmula de haversine).
**Aplicação.** Mapa base com atribuição; distância entre paradas; conexões a pé; simplificação de traçados (Douglas–Peucker).
- OpenStreetMap Foundation. *Copyright and License*. https://www.openstreetmap.org/copyright
- OSMF. *Licence/Attribution Guidelines* (2021). https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- OpenStreetMap Wiki. *Blocked tiles* (política de uso de tiles). https://wiki.openstreetmap.org/wiki/Blocked_tiles
- OpenStreetMap Wiki. *Overpass API*. https://wiki.openstreetmap.org/wiki/Overpass_API
- Prefeitura de São Paulo. *GeoSampa*. https://geosampa.prefeitura.sp.gov.br
- Douglas, D. H.; Peucker, T. K. Algorithms for the reduction of the number of points required to represent a digitized line or its caricature. *Cartographica*, 10(2), 1973.

## 3. Engenharia de dados

**Conceito.** Arquitetura em camadas de qualidade crescente (Bronze = como chegou; Silver = validado; Gold = pronto para consumo), com reprocessamento a partir do bruto; dimensões de qualidade (completude, validade, unicidade, consistência, atualidade, precisão); linhagem e metadados.
**Aplicação.** `bronze.py`, `silver.py`, `gold.py`, `_manifest.json`, `quality_checks`.
- Databricks. *What is the medallion lakehouse architecture?* https://docs.databricks.com/aws/en/lakehouse/medallion † — define o objetivo de "melhorar incremental e progressivamente a estrutura e a qualidade dos dados" a cada camada.
- DAMA International. *DAMA-DMBOK: Data Management Body of Knowledge*, 2ª ed., 2017 (governança, qualidade, metadados).
- Reis, J.; Housley, M. *Fundamentals of Data Engineering*. O'Reilly, 2022 (ciclo de vida de dados).

## 4. Estatística aplicada e séries temporais

**Conceito.** Estatística descritiva robusta (mediana, quartis, IQR); detecção de outliers com z-score modificado (MAD); séries temporais para sazonalidade diária/semanal e avaliação com divisão temporal.
**Aplicação.** `analysis.py` (velocidades, oferta por hora), hábitos (mediana/quartis), `robust_z`; plano de modelos preditivos com baseline e validação temporal.
- Iglewicz, B.; Hoaglin, D. C. *How to Detect and Handle Outliers*. ASQC Quality Press, 1993 (z-score modificado, limiar 3,5).
- Hyndman, R. J.; Athanasopoulos, G. *Forecasting: Principles and Practice*, 3ª ed. OTexts, 2021. https://OTexts.com/fpp3/ (acesso aberto).
- Yai, A. K. *Análise e visualização de dados do transporte público de ônibus da cidade de São Paulo*. Monografia (BCC), IME-USP, 2016 — uso combinado de GTFS e AVL da SPTrans.

## 5. Roteamento e sistemas de recomendação

**Conceito.** Caminhos mínimos (Dijkstra; A*); roteamento em transporte público dependente do horário e multicritério (Pareto entre tempo e baldeações); custo generalizado com pesos explícitos.
**Aplicação.** `planner.ts`: Dijkstra dependente do horário, cinco perfis de pesos, explicação dos fatores.
- Dijkstra, E. W. A note on two problems in connexion with graphs. *Numerische Mathematik*, 1, 269–271, 1959.
- Hart, P. E.; Nilsson, N. J.; Raphael, B. A formal basis for the heuristic determination of minimum cost paths. *IEEE Trans. Systems Science and Cybernetics*, 4(2), 1968.
- Delling, D.; Pajor, T.; Werneck, R. F. Round-Based Public Transit Routing. *Transportation Science*, 49(3), 591–604, 2015. https://doi.org/10.1287/trsc.2014.0534
- Dibbelt, J.; Pajor, T.; Strasser, B.; Wagner, D. Connection Scan Algorithm. *ACM Journal of Experimental Algorithmics*, 23, 2018. https://arxiv.org/abs/1703.05997
- Ricci, F.; Rokach, L.; Shapira, B. (eds.). *Recommender Systems Handbook*, 3ª ed. Springer, 2022 (explicabilidade e avaliação de recomendadores).

## 6. Ética algorítmica e governança

**Conceito.** Sistemas automatizados podem reproduzir desigualdades presentes nos dados; legitimidade da decisão automatizada; viés de cobertura; transparência e contestabilidade.
**Aplicação.** Ausência de índice de segurança; critérios "sem dados" explícitos; teto de confiança para relatos; k-anonimato; não uso de atributos sensíveis.
- Barocas, S.; Hardt, M.; Narayanan, A. *Fairness and Machine Learning: Limitations and Opportunities*. MIT Press, 2023. https://fairmlbook.org/ (acesso aberto, CC BY-NC-ND).
- Sweeney, L. k-anonymity: a model for protecting privacy. *Int. J. Uncertainty, Fuzziness and Knowledge-Based Systems*, 10(5), 2002.

## 7. Privacidade e proteção de dados (Brasil)

**Conceito.** LGPD: princípios (art. 6º), bases legais (art. 7º), direitos do titular (art. 18), segurança (arts. 46–49); orientações da ANPD.
**Aplicação.** Consentimento por finalidade, retenção, exportação, exclusão, pseudonimização, auditoria (ver [governanca-e-etica.md](governanca-e-etica.md)).
- Brasil. Lei nº 13.709, de 14 de agosto de 2018 (LGPD), texto compilado. https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm — **verifique a redação vigente**: serviços de consolidação registram alteração detectada em 2026.
- ANPD. *Guia Orientativo — Segurança da Informação para Agentes de Tratamento de Pequeno Porte*, 2021.
- ANPD. *Guia Orientativo — Definições dos Agentes de Tratamento e do Encarregado*, 2021/2022.
- ANPD. *Guia Orientativo — Hipóteses Legais: Legítimo Interesse*, 2024.
- ANPD. Consulta pública: *Guia de Anonimização e Pseudonimização* (jan.–mar. 2024) — criptografia e hash como pseudonimização; risco de reidentificação.
  Central de documentos: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/documentos-tecnicos-orientativos/documentos_tecnicos †

## 8. Contexto do desafio (Global Solution 2026 — CitizenTech)

- Enunciado da disciplina (PDF do projeto): ODS 11, dados abertos e LGPD como eixos; sugestões de fontes (GeoSampa, OpenStreetMap, Portal de Dados Abertos).
- Metrô SP — Portal da Transparência, relatórios "Indicadores". https://transparencia.metrosp.com.br/
