export interface SIAPSData {
  'NOME DA EQUIPE': string;
  'Resultado (CVAT)': number;
  'Classificação (CVAT)': string;
  'Pessoas Acompanhadas'?: string | number;
  'PARÂMETRO POPULACIONAL'?: string | number;
  'PARÂMETRO POPULACIONAL - MÍNIMO'?: string | number;
  'PARÂMETRO POPULACIONAL - MÁXIMO'?: string | number;
  'CADASTRO INDIVIDUAL'?: string | number;
  'CADASTRO INDIVIDUAL E CADASTRO DOMICILIAR'?: string | number;
  'PESSOAS COM SOMENTE CADASTRO INDIVIDUAL OU TERRITORIAL'?: string | number;
  'PESSOAS VINCULADAS E ACOMPANHADAS'?: string | number;
  'PESSOA ACOMPANHADA SEM CRITÉRIO DE VULNERABILIDADE'?: string | number;
  'BENEFICIÁRIO BPC OU PBF'?: string | number;
  'CRIANÇA ACOMPANHADA'?: string | number;
  'CRIANÇA BENEFICIÁRIA BPC OU PBF'?: string | number;
  'PESSOA IDOSA ACOMPANHADA'?: string | number;
  'PESSOA IDOSA BENEFICIÁRIA BPC OU PBF'?: string | number;
  'Limite Normativo'?: number;
  'MICI'?: string | number;
  'MICDT'?: string | number;
  'Total Cadastro'?: number;
  'Mês'?: string;
  'Ano'?: string | number;
  'Competência/Ano'?: string;
  [key: string]: any;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}
