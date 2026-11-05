# Integrações

Estado real de cada integração e o que é preciso para ativá-la. **Nenhuma API externa é simulada**: o que não está integrado aparece como indisponível na interface.

| Integração | Estado | Onde |
|---|---|---|
| GTFS (arquivo) | ✅ amostra SPTrans | `pipeline/` → `data/gold/<fonte>/` → `loadGold.ts` |
| Tiles OpenStreetMap | ✅ (cliente) | `TransitMap.tsx`, `VITE_MAP_TILE_URL` |
| Geolocalização do navegador | ✅ (só no aparelho) | `app/Navigate.tsx` |
| Banco PostgreSQL externo | ✅ suportado | `DATABASE_URL`; `docker-compose.yml` |
| PostGIS | ⚠️ migração pronta, não testada | `002_postgis_optional.sql`, `ENABLE_POSTGIS=true` |
| E-mail transacional | ❌ (link de verificação no console) | `modules/auth.ts` |
| GTFS SPTrans completo | 🗓️ requer cadastro | abaixo |
| Olho Vivo | 🗓️ requer token | abaixo |
| GTFS Realtime (alertas/lotação) | 🗓️ sem fonte pública identificada | tabela `service_alerts` |
| EMTU | 🗓️ requer cadastro | abaixo |
| Metrô — indicadores | 🗓️ PDFs/planilhas | abaixo |
| Overpass (estabelecimentos) | 🗓️ | abaixo |

## 1. Trocar a amostra pelo GTFS completo da SPTrans

1. Crie conta em https://www.sptrans.com.br/desenvolvedores/ e baixe o GTFS (`.zip`). Leia e respeite os termos de uso.
2. Coloque o arquivo em `data/sources/sptrans-gtfs/` (o `.gitignore` não versiona essa pasta).
3. Rode:
   ```bash
   cd pipeline
   python -m baldeia_pipeline.run --source ../data/sources/sptrans-gtfs/gtfs.zip --source-id sptrans_gtfs
   ```
4. No `.env`: `GOLD_SOURCE_DIR=data/gold/sptrans_gtfs` e reinicie a API. A carga cria nova `dataset_version` e a ativa.
5. Atualize `integration_status` de `sptrans_gtfs` em `data/sources/catalog.json` para `integrada`.

> Escala: o feed completo tem milhares de linhas. Avalie migrar o roteador para RAPTOR (ver metodologia) e medir latência antes de abrir ao público. Ajuste `RMSP_BBOX` se incluir outros municípios.

## 2. Olho Vivo (SPTrans) — tempo real de ônibus

- **Obter token:** área do desenvolvedor → "Meus aplicativos" → novo aplicativo. Guardar em `.env` como `SPTRANS_OLHOVIVO_TOKEN` (**nunca** no código ou no Git).
- **Uso previsto:** coletor periódico (ex.: a cada 60 s) grava respostas brutas no Bronze (`data/bronze/sptrans_olhovivo/<data>/<hora>.json`), normaliza na Silver e expõe previsão de chegada ao planejador, substituindo "metade do intervalo" quando houver previsão.
- **Contrato a implementar:** `interface ArrivalProvider { arrivals(stopId: string, routeId?: string): Promise<{ routeId: string; etaSecs: number; source: "olho_vivo" }[]> }` — injetado no planejador; na ausência, mantém a premissa atual.

## 3. GTFS Realtime (quando houver feed)

- Variáveis: `GTFS_RT_ALERTS_URL`, `GTFS_RT_VEHICLES_URL`.
- Alertas → `service_alerts` (`source_id`, `external_id`, período ativo, entidades afetadas). O roteador já reconhece confirmação oficial (`officialMatch` em `trust.ts`) e o rótulo "Confirmado por fonte oficial".
- `VehiclePosition.occupancy_status` → critério de lotação oficial, exibido com selo "Dado oficial".

## 4. EMTU e Metrô

- **EMTU:** cadastro e aceite (proíbe venda/sublicenciamento). Mesmo pipeline GTFS; `source-id emtu_gtfs`. Requer suporte a múltiplas fontes ativas simultâneas no `loadNetwork` (hoje carrega a versão ativa mais recente).
- **Metrô (indicadores):** extrair tabelas dos PDFs/planilhas mensais para `data/sources/metro/`, criar etapa Silver específica e tabela `station_demand_monthly (stop_id, mes, entradas_media_dia_util)`; uso: contexto de movimento por estação/mês, nunca lotação em tempo real.

## 5. Overpass (estabelecimentos próximos)

- Consulta por raio de 300 m de estações (`amenity=cafe|bakery`), **com cache** por estação (ex.: 7 dias) e User-Agent identificável.
- Exibir com atribuição OSM e horário de funcionamento apenas se presente no dado (`opening_hours`). Sem dado → não sugerir.

## 6. E-mail

- Variáveis previstas: `SMTP_URL`, `MAIL_FROM`. Substituir o `console.info` do link de verificação por envio real.

## Testes com dados controlados

- `pipeline/tests/test_pipeline.py`: feed GTFS sintético de teste (não representa rede real) cobrindo duplicidade, coordenadas inválidas, FK, horários > 24 h, imputação, quarentena e linhagem.
- `apps/api/test/*.test.ts`: banco em memória com a Gold real; autenticação, planejamento, comunidade, moderação, privacidade e unidades (confiança, PII, espera por frequência).
