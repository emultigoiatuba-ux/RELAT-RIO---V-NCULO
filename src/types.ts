export interface SIAPSData {
  'NOME DA EQUIPE': string;
  'Resultado (CVAT)': number;
  'Classificação  (CVAT)': string;
  'Pessoas Acompanhadas'?: string | number;
  'PARÂMETRO POPULACIONAL'?: string | number;
  [key: string]: any;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface UploadFeedback {
  type: 'nominal' | 'teams';
  recognized: string[];
  ignored: string[];
  missing: string[];
}
