# Pesquisa de fontes de dados

> **Região-piloto:** município de São Paulo (centro expandido), escolhida por concentrar fontes públicas de transporte e por alinhamento com o enunciado da Global Solution (GeoSampa e dados de SP como referência).
> **Data de consulta:** 05/11/2026. **Método:** busca web e leitura de documentação pública. Páginas que não puderam ser abertas diretamente a partir do ambiente de desenvolvimento estão sinalizadas.
> **Regra:** nenhuma API, cobertura ou licença foi presumida. Onde não houve confirmação, está escrito "não verificado".

O catálogo legível por máquina está em [`data/sources/catalog.json`](../data/sources/catalog.json) e é carregado na tabela `data_sources` a cada inicialização da API — a página **/transparencia** do site exibe o mesmo conteúdo.

## Resumo

| # | Fonte | Responsável | Categoria | Estado no repositório |
|---|---|---|---|---|
| 1 | GTFS SPTrans — amostra do centro (r5py) | SPTrans (original) · r5py/Ipea (redistribuição) | Oficial | **Integrada** (amostra histórica) |
| 2 | GTFS SPTrans completo | SPTrans | Oficial | Planejada |
| 3 | API Olho Vivo | SPTrans | Oficial (tempo real) | Planejada |
| 4 | EMTU — dados abertos (GTFS/API) | EMTU | Oficial | Planejada |
| 5 | Metrô SP — Portal da Transparência | Companhia do Metropolitano | Oficial (agregada) | Planejada |
| 6 | GTFS Realtime oficial para SP | — | Oficial | **Indisponível** (não identificado) |
| 7 | OpenStreetMap — tiles | OSM Foundation | Geográfica | **Integrada** (mapa) |
| 8 | Overpass API | Comunidade OSM / FOSSGIS | Geográfica | Planejada |
| 9 | GeoSampa | Prefeitura de SP (SMUL) | Geográfica | Planejada |
| 10 | Mobility Database | MobilityData | Catálogo | Planejada |
| 11 | Relatos comunitários | Baldeia (usuários) | Comunitária | **Integrada** |
| 12 | Dados de uso (viagens, favoritos, feedback) | Baldeia | Comportamental | **Integrada** (com consentimento) |
| 13 | Geolocalização do navegador | Dispositivo do usuário | Comportamental | **Integrada** (processada só no aparelho) |
| 14 | Dados sintéticos de demonstração | Baldeia | Demonstrativa | **Integrada** (`is_demo = true`) |

---

## A. Dados oficiais de transporte

### 1. GTFS SPTrans — amostra do centro de São Paulo *(integrada)*

- **Link:** https://github.com/r5py/r5py.sampledata.sao_paulo (arquivo `data/spo_gtfs.zip`; commit `4a09668`, 04/05/2025)
- **Responsável:** São Paulo Transporte S/A (publicação original). Redistribuído pelo projeto **r5py** como dado de exemplo, derivado do pacote **r5r** do Ipea.
- **Conteúdo verificado no arquivo:** `agency, stops, routes, trips, stop_times, calendar, frequencies, shapes`. **19 linhas** (7 CPTM, 6 Metrô — incluindo o monotrilho L15 —, 6 de ônibus), **654 paradas/estações**, **36 viagens-modelo**, **704 janelas de frequência**, **12.295 pontos de traçado**.
- **Formato:** GTFS Schedule (CSVs `.txt` em `.zip`, 192 KB). SHA-256 `b944d537…e2c7`.
- **Frequência:** estática. `calendar.txt` vai de **01/01/2008 a 01/05/2020** — **histórico**.
- **Licença:** segundo o r5py, "publicado pela SPTrans para uso aberto, sem licença específica". O pacote r5py é GPL-3.0-or-later ou MIT. *Termos da área do desenvolvedor da SPTrans: não verificados.*
- **Particularidade:** os ônibus (e trilhos) são descritos por **frequências** (`frequencies.txt`), não por horários fixos — confirmado também pelo livro do Ipea, que usa um recorte do mesmo feed.
- **Integração:** arquivo local → pipeline Python (`pipeline/`) → camada Gold → banco.
- **Limitações:** recorte geográfico; oferta **programada** (não observada); calendário expirado. O sistema exibe esse aviso em todo resultado de rota.

### 2. GTFS SPTrans completo *(planejada)*

- **Link:** https://www.sptrans.com.br/desenvolvedores/ (não pôde ser aberto do ambiente de desenvolvimento).
- **Evidências:** o Ipea indica essa página como origem do feed; o pacote R `spgtfs` exige login e senha para baixar; a lista OSM-Brasil (2014) relata atualização diária; um dataset da Mendeley (2022) descreve atualização "quase semanal".
- **Formato:** GTFS Schedule. **Acesso:** cadastro e login.
- **Integração prevista:** baixar o `.zip` e rodar `python -m baldeia_pipeline.run --source <arquivo> --source-id sptrans_gtfs`. O pipeline já é genérico para GTFS. Ver [integracoes.md](integracoes.md).
- **Limitações:** termos de uso não verificados; volume muito maior (o roteador atual deve ser reavaliado — ver metodologia).

### 3. API Olho Vivo (SPTrans) *(planejada)*

- **Link:** https://www.sptrans.com.br/desenvolvedores/
- **O que oferece (segundo clientes open source e reportagens):** busca de linhas e paradas, **posição de veículos**, **previsão de chegada** por parada/linha, corredores e empresas. Autenticação por **token** obtido ao cadastrar um aplicativo. Dados "em tempo real ou próximo do tempo real".
- **Formato:** REST/JSON **próprio** — não é GTFS Realtime.
- **Limitações:** cobre ônibus municipais (não Metrô/CPTM); sujeito a instabilidade — o Diário do Transporte noticiou manutenção em 17/09/2026 com possíveis falhas no Olho Vivo.
- **Uso previsto:** previsão de chegada em vez de "metade do intervalo"; detecção de atrasos.

### 4. EMTU — dados abertos *(planejada)*

- **Link:** http://www.emtu.sp.gov.br/emtu/dados-abertos/dados-abertos-principal/acesse-os-dados-abertos.fss
- **Conteúdo:** GTFS e API dos ônibus metropolitanos (intermunicipais).
- **Condições:** cadastro prévio e aceite de termos que **proíbem vender, sublicenciar ou alugar** os dados (Diário do Transporte, 2017).
- **Limitações:** pesquisa da própria EMTU (2018) registrou usuários relatando GTFS desatualizado e pedido por GTFS Realtime.

### 5. Metrô SP — Portal da Transparência *(planejada)*

- **Link:** https://transparencia.metrosp.com.br/
- **Conteúdo:** relatórios "Indicadores" em PDF com demanda (ex.: média de passageiros em dias úteis, estação mais movimentada). Pacotes de terceiros (ex.: `metrosp` em R) documentam séries de *entradas por estação — média dos dias úteis — por mês*.
- **Uso previsto:** perfil agregado de movimento por estação/mês para contextualizar o critério de lotação. **Não** serve para lotação em tempo real.
- **Limitações:** PDF/planilhas, granularidade mensal; linhas concedidas podem ter dados com outros operadores.

### 6. GTFS Realtime oficial para São Paulo *(indisponível)*

- **Especificação:** https://gtfs.org/realtime/ — entidades `TripUpdate`, `VehiclePosition` (com `occupancy_status`: EMPTY, MANY_SEATS_AVAILABLE, FEW_SEATS_AVAILABLE, STANDING_ROOM_ONLY, CRUSHED_STANDING_ROOM_ONLY, FULL…) e `Alert`, em Protocol Buffers.
- **Resultado da pesquisa:** **não identificamos** feed GTFS Realtime público de SPTrans, Metrô ou CPTM. Isso não prova que não exista; registra que não foi encontrado.
- **Preparação:** a tabela `service_alerts` está pronta para alertas oficiais; enquanto vazia, a interface informa "nenhuma fonte oficial integrada".

### CPTM

Não encontramos portal de dados abertos da CPTM com GTFS próprio. As linhas CPTM aparecem no GTFS da SPTrans (confirmado na amostra: L07 a L13). A CPTM publica política de proteção de dados e de divulgação de informação, consultadas apenas como referência de governança.

## B. Dados geográficos

### 7. OpenStreetMap — mapa base *(integrada)*

- **Link:** https://www.openstreetmap.org/copyright · política de tiles: https://wiki.openstreetmap.org/wiki/Blocked_tiles
- **Licença:** ODbL. Exige atribuição ("© OpenStreetMap contributors" / "OpenStreetMap") com indicação da licença.
- **Política de tiles:** uso pesado proibido sem permissão; requisições devem ser identificáveis (Referer em sites); não fixar a URL de `tile.openstreetmap.org` no código.
- **Como cumprimos:** atribuição no canto do mapa; `Referrer-Policy: strict-origin-when-cross-origin`; URL configurável por `VITE_MAP_TILE_URL`. **Para produção, usar provedor próprio ou comercial.**

### 8. Overpass API *(planejada)*
- **Link:** https://wiki.openstreetmap.org/wiki/Overpass_API · **Uso previsto:** cafeterias/estabelecimentos próximos (requisito 2.5). **Limitação:** instâncias públicas sofrem sobrecarga; volume pequeno e cache são obrigatórios. Enquanto não integrada, a funcionalidade **declara a ausência da fonte** em vez de sugerir locais.

### 9. GeoSampa *(planejada)*
- **Link:** https://geosampa.prefeitura.sp.gov.br · **Responsável:** Prefeitura de SP/SMUL. Cerca de 500 camadas, incluindo rede de transporte (corredores, terminais), com download aberto e metadados. Nova interface lançada em 2026. **Uso previsto:** enriquecer mapa e validar paradas.

### 10. Mobility Database *(planejada)*
- **Link:** https://mobilitydatabase.org · Catálogo com cópia diária de feeds e relatório de validação. Útil para expandir a outras cidades (ex.: Porto Alegre, Belo Horizonte aparecem no catálogo).

## C. Dados colaborativos

### 11. Relatos comunitários *(integrada)*
Tabela `community_reports` + `report_confirmations` + `report_flags`. Associados a **parada/estação** (não a coordenadas do autor), com tipo, horário, expiração e confiança calculada. Ver [governanca-e-etica.md](governanca-e-etica.md) §5.

## D. Dados comportamentais

### 12. Uso da plataforma *(integrada, com consentimento)*
`journeys`, `journey_legs`, `journey_checkpoints`, `favorite_places`, `recommendations` (feedback útil/não útil). Histórico só com consentimento; retenção de 180 dias.

### 13. Geolocalização *(integrada no aparelho)*
API de Geolocalização do navegador, mediante permissão. Comparação com as paradas é feita **no aparelho**; o servidor recebe apenas "parada X confirmada".

## E. Dados demonstrativos

### 14. Dados sintéticos *(integrada, rotulada)*
Usuários e relatos gerados por `apps/api/src/db/demo.ts` com semente fixa, todos com `is_demo = true` e selo **"Demonstração/sintético"** na interface. Desativáveis com `SEED_DEMO=false`.

---

## Alternativas para fontes indisponíveis

| Lacuna | Alternativa adotada | Próximo passo |
|---|---|---|
| Lotação oficial | Relatos comunitários ponderados por confiança; critério declarado "sem dados" quando não há relatos | Indicadores mensais do Metrô; `occupancy_status` se surgir GTFS-RT |
| Tempo real | Espera = metade do intervalo programado (premissa explícita) | Olho Vivo |
| Alertas oficiais | Tabela vazia + aviso na interface | Canais oficiais / GTFS-RT |
| GTFS atual | Amostra histórica rotulada | Cadastro na área do desenvolvedor SPTrans |
| Estabelecimentos | Funcionalidade informa ausência de fonte | Overpass com cache |
| Fotos de estações | Placeholder com explicação | Acervo próprio ou imagens com licença aberta |

## Referências desta pesquisa
- Pereira, R. H. M.; Herszenhut, D. *Introdução à Acessibilidade Urbana*, cap. 4 — Ipea, 2023. https://ipeagit.github.io/intro_access_book/4_dados_gtfs.en.html
- r5py sample data São Paulo — https://github.com/r5py/r5py.sampledata.sao_paulo · https://pypi.org/project/r5py-sampledata-sao-paulo/
- Diário do Transporte, "EMTU abre dados dos transportes metropolitanos…", 14/09/2017.
- Diário do Transporte, manutenção do Olho Vivo, 16/09/2026.
- OSM Foundation — Attribution Guidelines (2021): https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- Gestão Urbana SP — Novo GeoSampa (2026).
