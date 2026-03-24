export interface SIAPSData {
  'NOME DA EQUIPE': string;
  'Resultado (CVAT)': number;
  'Classificação (CVAT)': string;
  'Pessoas Acompanhadas'?: string | number;
  'PARÂMETRO POPULACIONAL'?: string | number;
  'Limite Normativo'?: number;
  'MICI'?: string | number;
  'MICDT'?: string | number;
  'Total Cadastro'?: number;
  'Mês'?: string;
  'Ano'?: string | number;
  [key: string]: any;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}
