# Identidade visual

## 1. Três propostas de nome

| Nome | Significado | Relação com a proposta | Pronúncia | Potencial visual |
|---|---|---|---|---|
| **Baldeia** ⭐ | *baldeação* + *aldeia* (comunidade) | o momento mais crítico do transporte coletivo (a troca) + o cuidado coletivo dos relatos | "bal-DEI-a" — 3 sílabas, sem ambiguidade | o "b" vira mapa de metrô: duas linhas e uma estação de baldeação |
| **Fluxa** | fluxo de pessoas + fluxo de dados | une mobilidade e pipeline de dados | "FLU-xa" — curta | ondas e setas; risco de parecer genérico |
| **Rotaviva** | rota que muda com dados "vivos" | recomendações atualizadas pela comunidade | "ro-ta-VI-va" — 4 sílabas | linha pulsante; menos distintivo |

**Recomendação: Baldeia** — é a mais distintiva, nasce do vocabulário do passageiro paulistano e sustenta a narrativa "comunidade + dados".

**Disponibilidade:** em busca web (05/11/2026) não encontramos app de mobilidade chamado "Baldeia"; para "Fluxa", existem marcas "Flux" em mobilidade (risco de confusão); para "Rotaviva", nenhum resultado relevante. **Isso não é verificação de marca.** Antes de uso comercial: consultar o INPI (classes 9, 39 e 42), domínios (registro.br) e lojas de aplicativos.

## 2. Logotipo

Arquivos em `brand/` (também copiados para `apps/web/public/brand/`), gerados por `brand/build_brand.py` com o texto convertido em curvas (não depende da fonte instalada):

| Arquivo | Uso |
|---|---|
| `baldeia-horizontal.svg` / `.png` | principal, fundos claros |
| `baldeia-horizontal-negativo.svg` | fundos escuros |
| `baldeia-simbolo.svg` / `.png` | símbolo isolado |
| `baldeia-simbolo-app.svg` / `.png` | ícone de app/favicon |
| `baldeia-mono-escuro.svg`, `baldeia-mono-claro.svg` | monocromáticas (impressão, carimbo) |

**Conceito:** o "b" minúsculo é um diagrama de metrô — a haste é uma linha (tinta), o bojo é outra linha (sinal) e o encontro é uma **estação de baldeação** (círculo branco com contorno). O pingo do "i" é o mesmo ponto laranja: a parada.

Área de proteção: altura do círculo da estação em todos os lados. Tamanho mínimo: 24 px de altura (símbolo), 96 px de largura (horizontal).

## 3. Paleta

| Token | Hex | Uso |
|---|---|---|
| Tinta | `#101418` | texto, botões principais, linhas do mapa |
| Papel | `#F6F3EC` | fundo principal (leve, quente) |
| Giz | `#FFFFFF` | superfícies |
| Sinal | `#FF4D2E` | acento, CTA, destaque (não para texto pequeno sobre papel) |
| Sinal-texto | `#C2321A` | sinal em texto (contraste AA) |
| Lavanda / Menta / Céu / Areia | `#E9E4FB` `#DDF3E8` `#DFEAFB` `#F6E8D2` | fundos de seção |

**Semântica de origem do dado** (usada em todo o produto, sempre com texto, nunca só cor):

| Origem | Cor | Selo |
|---|---|---|
| Oficial | azul `#2B59C3` | "Dado oficial" |
| Comunidade | `#C2321A` | "Comunidade" |
| Estimado/premissa | violeta `#5B3FC4` | "Estimado" |
| Demonstração | cinza **hachurado** `#4B5563` | "Demonstração/sintético" |

## 4. Tipografia

**Poppins** (SIL Open Font License), servida localmente via `@fontsource/poppins` (sem chamada ao Google Fonts — evita vazar IP do visitante). Pesos 400/500/600/700. Títulos 700 com espaçamento negativo; corpo 400 a 16 px, entrelinha 1,6.

## 5. Elementos de identidade

- **Linha de metrô** como divisor (traço com estações) e como linha do tempo das etapas.
- **Estações numeradas** (círculos com contorno) para listas de passos.
- **Hachura** como marca de "demonstração/planejado" em selos, diagramas e marcadores.
- Movimento: linhas que se desenham ao entrar na tela, pontos que percorrem rotas; tudo desligado com `prefers-reduced-motion`.
- Fundo do hero preparado para imagem exclusiva: variável CSS `--hero-bg-image` em `apps/web/src/styles/global.css`, com parallax suave.
