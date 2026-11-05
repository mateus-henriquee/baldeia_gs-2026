/**
 * Conteúdo editável da landing. Integrantes: PLACEHOLDERS até recebermos dados reais —
 * não inventamos nomes, fotos ou links. Edite este arquivo para preencher.
 */
export interface Member {
  placeholder: boolean; nome: string; funcao: string; apresentacao: string; contribuicao: string;
  foto: string | null; linkedin: string | null; github: string | null;
}
export const TEAM: Member[] = [1, 2, 3].map((n) => ({
  placeholder: true,
  nome: `Integrante ${n} — nome completo`,
  funcao: "Função no projeto (a definir)",
  apresentacao: "Breve apresentação profissional. Substitua pelo texto real do(a) integrante.",
  contribuicao: "Contribuição no projeto (ex.: pipeline de dados, interface, governança).",
  foto: null, linkedin: null, github: null,
}));

export interface Ref { titulo: string; autor: string; url: string; tema: string; uso: string }
/** Referências consultadas em 2026-11-05 — detalhes em docs/referencial-teorico.md. */
export const REFERENCES: Ref[] = [
  { tema: "Dados de transporte", titulo: "GTFS Schedule — referência", autor: "MobilityData / comunidade GTFS", url: "https://gtfs.org/schedule/reference/", uso: "Formato dos dados de horários, paradas e linhas" },
  { tema: "Dados de transporte", titulo: "GTFS Realtime — referência", autor: "MobilityData / comunidade GTFS", url: "https://gtfs.org/realtime/", uso: "Padrão previsto para alertas, posições e lotação" },
  { tema: "Dados de transporte", titulo: "Área do desenvolvedor (GTFS e Olho Vivo)", autor: "SPTrans", url: "https://www.sptrans.com.br/desenvolvedores/", uso: "Fonte oficial da rede municipal" },
  { tema: "Dados de transporte", titulo: "Amostra GTFS de São Paulo (r5py sample data)", autor: "r5py (derivado do r5r/Ipea; dados SPTrans)", url: "https://github.com/r5py/r5py.sampledata.sao_paulo", uso: "Dados reais usados nesta demonstração" },
  { tema: "Dados de transporte", titulo: "Introdução à acessibilidade urbana — cap. 4, dados GTFS", autor: "Pereira & Herszenhut / Ipea (2023)", url: "https://ipeagit.github.io/intro_access_book/4_dados_gtfs.en.html", uso: "Estrutura do GTFS da SPTrans" },
  { tema: "Dados geográficos", titulo: "Copyright and License", autor: "OpenStreetMap Foundation", url: "https://www.openstreetmap.org/copyright", uso: "Licença ODbL e atribuição do mapa" },
  { tema: "Dados geográficos", titulo: "Tile usage policy / Blocked tiles", autor: "OSMF Operations", url: "https://wiki.openstreetmap.org/wiki/Blocked_tiles", uso: "Limites de uso dos tiles públicos" },
  { tema: "Algoritmos", titulo: "Round-Based Public Transit Routing (RAPTOR)", autor: "Delling, Pajor & Werneck — Transportation Science 49(3), 2015", url: "https://doi.org/10.1287/trsc.2014.0534", uso: "Roteamento multicritério em transporte público" },
  { tema: "Algoritmos", titulo: "Connection Scan Algorithm", autor: "Dibbelt, Pajor, Strasser & Wagner — ACM JEA 23, 2018", url: "https://arxiv.org/abs/1703.05997", uso: "Alternativa sem grafo para horários fixos" },
  { tema: "Estatística", titulo: "Forecasting: Principles and Practice, 3ª ed.", autor: "Hyndman & Athanasopoulos — OTexts, 2021", url: "https://OTexts.com/fpp3/", uso: "Séries temporais e avaliação de previsões" },
  { tema: "Engenharia de dados", titulo: "What is the medallion lakehouse architecture?", autor: "Databricks", url: "https://docs.databricks.com/aws/en/lakehouse/medallion", uso: "Camadas Bronze, Silver e Gold" },
  { tema: "Ética algorítmica", titulo: "Fairness and Machine Learning", autor: "Barocas, Hardt & Narayanan — MIT Press, 2023", url: "https://fairmlbook.org/", uso: "Vieses, desigualdade de dados e legitimidade" },
  { tema: "Privacidade", titulo: "Lei nº 13.709/2018 (LGPD) — texto compilado", autor: "Presidência da República", url: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm", uso: "Princípios, bases legais e direitos" },
  { tema: "Privacidade", titulo: "Guia de Segurança da Informação para agentes de pequeno porte", autor: "ANPD (2021)", url: "https://www.gov.br/anpd/pt-br/centrais-de-conteudo/documentos-tecnicos-orientativos/documentos_tecnicos", uso: "Medidas técnicas e administrativas" },
  { tema: "Privacidade", titulo: "Guia Orientativo — Hipóteses legais: legítimo interesse", autor: "ANPD (2024)", url: "https://www.gov.br/anpd/pt-br/centrais-de-conteudo/documentos-tecnicos-orientativos/documentos_tecnicos", uso: "Avaliação de bases legais por tratamento" },
];
