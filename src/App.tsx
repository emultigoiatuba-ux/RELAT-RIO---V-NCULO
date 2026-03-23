/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import Papa from 'papaparse';
import { 
  Trophy, 
  Upload, 
  FileText, 
  MessageSquare, 
  TrendingUp, 
  AlertCircle,
  ChevronRight,
  Send,
  Loader2,
  RefreshCw,
  Activity,
  Users,
  Target,
  Home,
  Heart,
  Search,
  UserCheck,
  Filter,
  ClipboardList
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SIAPSData, Message, UploadFeedback } from './types';
import { cn } from './lib/utils';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

const SYSTEM_INSTRUCTION = `Você é um Consultor Especialista em Gestão da Atenção Primária à Saúde, com profundo conhecimento da Nota Técnica Nº 30/2025-CGESCO/DESCO/SAPS/MS. 

Seu objetivo é analisar os dados do SIAPS (vínculo e acompanhamento) e fornecer orientações práticas baseadas na metodologia oficial:

1. **Metodologia de Cálculo (CVAT)**:
   - **Dimensão Cadastro (30%)**: Valoriza a completude. Fator 0.75 para cadastro individual (MICI) e 1.5 para cadastro completo (MICI + Domiciliar/Territorial - MICDT). Cadastros devem estar atualizados nos últimos 24 meses.
   - **Dimensão Acompanhamento (70%)**: Foca na continuidade do cuidado (mais de um contato em 12 meses, sendo pelo menos um 'prática de cuidado'). Pesos de vulnerabilidade: Idoso/Criança (1.2), BPC/PBF (1.3), Ambos (2.5).
   - **Satisfação do Usuário**: Pontuação extra (0.15 a 0.30) para equipes com avaliações no app 'Meu SUS Digital'.

2. **Suas Tarefas**:
   - Analisar o Resultado (CVAT) e Classificação da equipe.
   - Gerar uma Matriz SWOT focada em Vínculo e Territorialização.
   - Sugerir 3 ações imediatas baseadas nos critérios da Nota Técnica (ex: qualificação de cadastros incompletos, busca ativa de vulneráveis, incentivo ao uso do Meu SUS Digital).
   - **Levantamento Nominal**: Se o usuário fornecer uma lista de CPFs ou cidadãos, ajude a identificar quem precisa de acompanhamento prioritário com base nos critérios de vulnerabilidade.

3. **Busca Ativa Estratégica**:
   - Quando questionado sobre como melhorar a busca ativa, forneça orientações detalhadas para identificar e priorizar cidadãos em vulnerabilidade: Idosos (60+), Crianças (0-12), Beneficiários de BPC/PBF e Gestantes.
   - **Estratégias de Priorização**: Utilize o levantamento nominal para identificar cidadãos que não tiveram pelo menos um contato de 'prática de cuidado' nos últimos 12 meses.
   - **Foco no Resultado**: Explique que o acompanhamento desses grupos vulneráveis possui pesos diferenciados (1.2 a 2.5), o que potencializa significativamente a Dimensão Acompanhamento (70% do CVAT).

Use uma linguagem acolhedora, técnica e motivadora. Explique que o cadastro territorializa e identifica, enquanto o acompanhamento consolida a continuidade do cuidado.`;

const getClassificationRank = (classification: string) => {
  const c = classification.toUpperCase();
  if (c.includes('ÓTIMO')) return 4;
  if (c.includes('BOM')) return 3;
  if (c.includes('SUFICIENTE')) return 2;
  if (c.includes('REGULAR')) return 1;
  return 0;
};

const getClassificationStyle = (classification: string) => {
  const c = classification.toUpperCase();
  if (c.includes('ÓTIMO')) return { badge: 'badge-otimo', status: 'status-otimo' };
  if (c.includes('BOM')) return { badge: 'badge-bom', status: 'status-bom' };
  if (c.includes('REGULAR')) return { badge: 'badge-regular', status: 'status-regular' };
  if (c.includes('SUFICIENTE')) return { badge: 'badge-suficiente', status: 'status-suficiente' };
  return { badge: 'bg-slate-100 text-slate-700', status: 'bg-white' };
};

export default function App() {
  const [data, setData] = useState<SIAPSData[]>([]);
  const [nominalData, setNominalData] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'teams' | 'nominal'>('teams');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [swotAnalysis, setSwotAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [ineFilter, setIneFilter] = useState('');
  const [vulnerabilityFilters, setVulnerabilityFilters] = useState<string[]>([]);
  const [uploadFeedback, setUploadFeedback] = useState<UploadFeedback | null>(null);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim().toUpperCase().replace(/\s+/g, ' '),
      complete: (results) => {
        try {
          const rawData = results.data as any[];
          
          if (!rawData || rawData.length === 0) {
            throw new Error('O arquivo está vazio ou não pôde ser lido.');
          }

          // Check for required columns using normalized (uppercase) names
          const headers = Object.keys(rawData[0]);
          const hasCPF = headers.includes('CPF');
          const hasEquipe = headers.includes('NOME DA EQUIPE') || headers.includes('EQUIPE');
          const hasResultado = headers.includes('RESULTADO (CVAT)');

          if (hasCPF) {
            const nominalRequired = ['CPF'];
            const nominalOptional = [
              'NOME', 'NOME DO CIDADÃO', 
              'EQUIPE', 'NOME DA EQUIPE', 
              'INE', 'IDENTIFICADOR NACIONAL DE EQUIPE', 
              'STATUS', 'ACOMPANHAMENTO', 
              'VULNERABILIDADE', 'IDADE', 'BPC', 'PBF', 'BOLSA FAMÍLIA', 'GESTANTE'
            ];
            
            const recognized = headers.filter(h => nominalRequired.includes(h) || nominalOptional.includes(h));
            const ignored = headers.filter(h => !recognized.includes(h));
            const missing = nominalRequired.filter(h => !headers.includes(h));

            setUploadFeedback({
              type: 'nominal',
              recognized,
              ignored,
              missing
            });

            const parsedNominal = rawData.map((row: any) => {
              const cpf = row['CPF'] || 'N/A';
              const nome = row['NOME'] || row['NOME DO CIDADÃO'] || 'Cidadão Sem Nome';
              const equipe = row['EQUIPE'] || row['NOME DA EQUIPE'] || 'Não Informada';
              const ine = row['INE'] || row['IDENTIFICADOR NACIONAL DE EQUIPE'] || 'Não Informado';
              const status = row['STATUS'] || row['ACOMPANHAMENTO'] || 'Pendente';
              
              let vulnerabilidade = row['VULNERABILIDADE'] || '';
              const idadeStr = row['IDADE'] || '-1';
              const idade = parseInt(idadeStr);
              
              const isBPC = String(row['BPC'] || '').toLowerCase().startsWith('s');
              const isPBF = String(row['PBF'] || row['BOLSA FAMÍLIA'] || '').toLowerCase().startsWith('s');
              const isGestante = String(row['GESTANTE'] || '').toLowerCase().startsWith('s');

              const vulnerabilities = [];
              if (vulnerabilidade) vulnerabilities.push(vulnerabilidade);
              if (idade >= 60) vulnerabilities.push('Idoso');
              if (idade >= 0 && idade <= 12) vulnerabilities.push('Criança');
              if (isBPC) vulnerabilities.push('BPC');
              if (isPBF) vulnerabilities.push('PBF');
              if (isGestante) vulnerabilities.push('Gestante');

              return {
                cpf,
                nome,
                equipe,
                ine,
                status,
                vulnerabilidade: vulnerabilities.length > 0 ? vulnerabilities.join(', ') : 'Não Identificada',
                isPriority: vulnerabilities.length > 0
              };
            });
            setNominalData(parsedNominal);
            setActiveTab('nominal');
          } else if (hasEquipe && hasResultado) {
            const teamsRequired = ['RESULTADO (CVAT)'];
            const teamsOptional = ['NOME DA EQUIPE', 'EQUIPE', 'CLASSIFICAÇÃO (CVAT)', 'CLASSIFICAÇÃO', 'PESSOAS ACOMPANHADAS', 'PARÂMETRO POPULACIONAL'];
            
            const recognized = headers.filter(h => teamsRequired.includes(h) || teamsOptional.includes(h));
            const ignored = headers.filter(h => !recognized.includes(h));
            const missing = teamsRequired.filter(h => !headers.includes(h));

            setUploadFeedback({
              type: 'teams',
              recognized,
              ignored,
              missing
            });

            const parsedData = rawData.map((row: any) => {
              const rawResult = row['RESULTADO (CVAT)'] || '0';
              const resultValue = typeof rawResult === 'string' 
                ? parseFloat(rawResult.replace(',', '.')) 
                : parseFloat(rawResult);
              
              return {
                ...row,
                'Resultado (CVAT)': isNaN(resultValue) ? 0 : resultValue,
                'NOME DA EQUIPE': row['NOME DA EQUIPE'] || row['EQUIPE'] || 'Equipe Sem Nome',
                'Classificação (CVAT)': row['CLASSIFICAÇÃO (CVAT)'] || row['CLASSIFICAÇÃO'] || 'N/A',
                'Pessoas Acompanhadas': row['PESSOAS ACOMPANHADAS'] || '0',
                'PARÂMETRO POPULACIONAL': row['PARÂMETRO POPULACIONAL'] || '0'
              };
            }).filter(item => item['NOME DA EQUIPE'] !== 'Equipe Sem Nome');

            if (parsedData.length === 0) {
              throw new Error('Nenhuma equipe válida encontrada no relatório.');
            }

            const sortedData = parsedData.sort((a, b) => {
              const rankA = getClassificationRank(a['Classificação (CVAT)']);
              const rankB = getClassificationRank(b['Classificação (CVAT)']);
              if (rankA !== rankB) return rankB - rankA;
              return b['Resultado (CVAT)'] - a['Resultado (CVAT)'];
            });

            setData(sortedData as any);
            setSelectedTeam(sortedData[0]['NOME DA EQUIPE']);
            setActiveTab('teams');
          } else {
            throw new Error('Formato de colunas não reconhecido. Certifique-se de que o arquivo contém as colunas esperadas (CPF para nominal ou Equipe/Resultado para desempenho).');
          }
          setLoading(false);
        } catch (err: any) {
          setError(err.message || 'Erro ao processar o arquivo. Verifique o formato do CSV.');
          setLoading(false);
        }
      },
      error: (err) => {
        setError('Erro na leitura do arquivo CSV: ' + err.message);
        setLoading(false);
      }
    });
  };

  const generateSWOT = async () => {
    if (!selectedTeam || data.length === 0) return;
    
    setAnalyzing(true);
    try {
      const teamData = data.find(t => t['NOME DA EQUIPE'] === selectedTeam);
      const prompt = `Analise os seguintes dados de desempenho da equipe de saúde ${selectedTeam}:
      - Resultado CVAT: ${teamData?.['Resultado (CVAT)']}
      - Classificação: ${teamData?.['Classificação (CVAT)']}
      - Pessoas Acompanhadas: ${teamData?.['Pessoas Acompanhadas'] || 'N/A'}
      - Parâmetro Populacional: ${teamData?.['PARÂMETRO POPULACIONAL'] || 'N/A'}
      
      Com base nisso, crie uma Matriz SWOT focada em 'Vínculo e Acompanhamento'.
      Aponte Forças, Fraquezas, Oportunidades e Ameaças. 
      Ao final, dê 3 dicas práticas de gestão para melhorar o índice.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { systemInstruction: SYSTEM_INSTRUCTION }
      });

      setSwotAnalysis(response.text || 'Não foi possível gerar a análise.');
    } catch (err) {
      console.error(err);
      setSwotAnalysis('Erro ao gerar análise. Tente novamente.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || chatLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatLoading(true);

    try {
      const topTeam = data[0];
      const context = data.length > 0 
        ? `Contexto: O usuário é um profissional de saúde. O ranking atual mostra que a melhor equipe (${topTeam['NOME DA EQUIPE']}) tem nota ${topTeam['Resultado (CVAT)']}.`
        : '';
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `${context}\n\nPergunta do usuário: ${userMessage}`,
        config: { systemInstruction: SYSTEM_INSTRUCTION }
      });

      setMessages(prev => [...prev, { role: 'assistant', content: response.text || 'Desculpe, não consegui processar sua pergunta.' }]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Ocorreu um erro ao consultar o assistente.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const downloadNominalCSV = () => {
    if (filteredNominal.length === 0) return;
    const csv = Papa.unparse(filteredNominal);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `levantamento_nominal_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleFollowUp = (index: number) => {
    const newData = [...nominalData];
    const currentStatus = newData[index].status.toLowerCase();
    if (currentStatus.includes('ok') || currentStatus.includes('concluído')) {
      newData[index].status = 'Pendente';
    } else {
      newData[index].status = 'Acompanhamento OK';
    }
    setNominalData(newData);
  };

  const nominalStats = {
    total: nominalData.length,
    followedUp: nominalData.filter(d => d.status.toLowerCase().includes('ok') || d.status.toLowerCase().includes('concluído')).length,
    vulnerable: nominalData.filter(d => d.vulnerabilidade.toLowerCase() !== 'não identificada' && d.vulnerabilidade.toLowerCase() !== 'n/a').length
  };

  const globalStats = {
    avgCVAT: data.length > 0 ? (data.reduce((acc, curr) => acc + curr['Resultado (CVAT)'], 0) / data.length).toFixed(2) : 0,
    topClassification: data.length > 0 ? data[0]['Classificação  (CVAT)'] : 'N/A',
    counts: {
      otimo: data.filter(d => d['Classificação  (CVAT)'].toUpperCase().includes('ÓTIMO')).length,
      bom: data.filter(d => d['Classificação  (CVAT)'].toUpperCase().includes('BOM')).length,
      suficiente: data.filter(d => d['Classificação  (CVAT)'].toUpperCase().includes('SUFICIENTE')).length,
      regular: data.filter(d => d['Classificação  (CVAT)'].toUpperCase().includes('REGULAR')).length,
    }
  };

  const filteredNominal = nominalData.filter(item => {
    const matchesSearch = item.nome.toLowerCase().includes(searchTerm.toLowerCase()) || 
      item.cpf.includes(searchTerm) ||
      item.equipe.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.ine.includes(searchTerm);
    
    const matchesIne = !ineFilter || item.ine === ineFilter;
    
    if (vulnerabilityFilters.length === 0) return matchesSearch && matchesIne;
    
    const itemVulnerabilities = item.vulnerabilidade.toLowerCase();
    const matchesFilter = vulnerabilityFilters.some(filter => {
      if (filter === 'BPC/PBF') {
        return itemVulnerabilities.includes('bpc') || itemVulnerabilities.includes('pbf');
      }
      return itemVulnerabilities.includes(filter.toLowerCase());
    });
    
    return matchesSearch && matchesFilter && matchesIne;
  });

  const toggleVulnerabilityFilter = (filter: string) => {
    setVulnerabilityFilters(prev => 
      prev.includes(filter) 
        ? prev.filter(f => f !== filter) 
        : [...prev, filter]
    );
  };

  const top3 = data.slice(0, 3);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-sm border-2 border-psf-green/20 relative overflow-hidden group">
              <img 
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Logotipo_do_Programa_Sa%C3%BAde_da_Fam%C3%ADlia.svg/1200px-Logotipo_do_Programa_Sa%C3%BAde_da_Fam%C3%ADlia.svg.png" 
                alt="Logo PSF" 
                className="w-12 h-12 object-contain relative z-10"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-br from-psf-green/5 to-psf-blue/5 group-hover:opacity-100 transition-opacity" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-2">
                APS Realidade <span className="text-psf-blue">360</span>
              </h1>
              <p className="text-[10px] font-bold text-psf-green uppercase tracking-widest mt-1 flex items-center gap-1">
                <Activity size={10} />
                Inteligência a Serviço da Gestão
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex bg-slate-100 p-1 rounded-xl mr-4">
              <button 
                onClick={() => setActiveTab('teams')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                  activeTab === 'teams' ? "bg-white text-psf-blue shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Equipes
              </button>
              <button 
                onClick={() => setActiveTab('nominal')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                  activeTab === 'nominal' ? "bg-white text-psf-blue shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Nominal
              </button>
            </div>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 bg-psf-blue hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md active:scale-95"
            >
              <Upload size={16} />
              Importar CSV
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept=".csv" 
              className="hidden" 
            />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <AnimatePresence>
          {uploadFeedback && (
            <motion.div 
              initial={{ opacity: 0, y: -20, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -20, height: 0 }}
              className="bg-white border-2 border-slate-100 rounded-3xl p-6 shadow-sm overflow-hidden"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-psf-blue/10 p-2 rounded-lg">
                    <Info className="text-psf-blue w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Feedback de Importação</h3>
                    <p className="text-xs text-slate-500 font-medium">Relatório do tipo: <span className="text-psf-blue font-bold uppercase">{uploadFeedback.type === 'nominal' ? 'Levantamento Nominal' : 'Desempenho de Equipes'}</span></p>
                  </div>
                </div>
                <button onClick={() => setUploadFeedback(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <XCircle size={20} />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-psf-green">
                    <CheckCircle2 size={14} />
                    <span className="text-[10px] font-black uppercase tracking-wider">Colunas Reconhecidas ({uploadFeedback.recognized.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {uploadFeedback.recognized.map(col => (
                      <span key={col} className="text-[9px] font-bold px-2 py-1 bg-psf-green/5 text-psf-green border border-psf-green/10 rounded-md">{col}</span>
                    ))}
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-slate-400">
                    <Info size={14} />
                    <span className="text-[10px] font-black uppercase tracking-wider">Colunas Ignoradas ({uploadFeedback.ignored.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {uploadFeedback.ignored.length > 0 ? uploadFeedback.ignored.map(col => (
                      <span key={col} className="text-[9px] font-bold px-2 py-1 bg-slate-50 text-slate-400 border border-slate-100 rounded-md">{col}</span>
                    )) : <span className="text-[9px] text-slate-400 italic">Nenhuma coluna ignorada</span>}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-psf-red">
                    <AlertCircle size={14} />
                    <span className="text-[10px] font-black uppercase tracking-wider">Colunas Faltantes ({uploadFeedback.missing.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {uploadFeedback.missing.length > 0 ? uploadFeedback.missing.map(col => (
                      <span key={col} className="text-[9px] font-bold px-2 py-1 bg-psf-red/5 text-psf-red border border-psf-red/10 rounded-md">{col}</span>
                    )) : <span className="text-[9px] text-psf-green font-bold">Tudo OK! Nenhuma coluna obrigatória faltando.</span>}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {data.length === 0 && nominalData.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center space-y-6"
          >
            <div className="flex gap-4">
              <div className="bg-psf-green/10 p-6 rounded-3xl border border-psf-green/20">
                <ClipboardList className="w-12 h-12 text-psf-green" />
              </div>
              <div className="bg-psf-blue/10 p-6 rounded-3xl border border-psf-blue/20">
                <Users className="w-12 h-12 text-psf-blue" />
              </div>
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">Gestão 360 da Atenção Primária</h2>
              <p className="text-slate-500 text-sm leading-relaxed">Importe seus relatórios do SIAPS para monitorar o desempenho das equipes ou realizar o levantamento nominal de cidadãos por CPF.</p>
            </div>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-3 bg-white border-2 border-slate-200 hover:border-psf-blue text-slate-700 px-8 py-4 rounded-2xl font-bold transition-all shadow-sm group"
            >
              <Upload size={20} className="text-psf-blue group-hover:scale-110 transition-transform" />
              Selecionar Relatório SIAPS
            </button>
            {error && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
                <AlertCircle size={18} />
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}
          </motion.div>
        ) : (
          <>
            {activeTab === 'teams' ? (
              <>
                {/* Global Diagnosis Summary */}
                <div className="flex flex-col gap-6">
                  <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="glass-card p-4 flex items-center gap-4 border-l-4 border-psf-blue">
                      <div className="bg-psf-blue/10 p-3 rounded-xl">
                        <Activity className="text-psf-blue w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Média CVAT Global</p>
                        <p className="text-xl font-black text-slate-800">{globalStats.avgCVAT}</p>
                      </div>
                    </div>
                    <div className="glass-card p-4 flex items-center gap-4 border-l-4 border-psf-green">
                      <div className="bg-psf-green/10 p-3 rounded-xl">
                        <Target className="text-psf-green w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Melhor Classificação</p>
                        <p className="text-xl font-black text-slate-800">{globalStats.topClassification}</p>
                      </div>
                    </div>
                    <div className="glass-card p-4 flex items-center gap-4 border-l-4 border-psf-yellow">
                      <div className="bg-psf-yellow/10 p-3 rounded-xl">
                        <Users className="text-psf-yellow w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total de Equipes</p>
                        <p className="text-xl font-black text-slate-800">{data.length}</p>
                      </div>
                    </div>
                    <div className="glass-card p-4 flex items-center gap-4 border-l-4 border-psf-red">
                      <div className="bg-psf-red/10 p-3 rounded-xl">
                        <AlertCircle className="text-psf-red w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipes Críticas</p>
                        <p className="text-xl font-black text-slate-800">{globalStats.counts.regular + globalStats.counts.suficiente}</p>
                      </div>
                    </div>
                  </section>

                  {/* Classification Breakdown Detail */}
                  <div className="glass-card p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xs font-black text-slate-800 uppercase tracking-[0.2em]">Quantitativo por Classificação</h3>
                      <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full">
                        <div className="w-2 h-2 rounded-full bg-psf-green animate-pulse" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Dados em Tempo Real</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
                      <div className="space-y-2">
                        <div className="flex justify-between items-end">
                          <span className="text-[10px] font-black text-psf-blue uppercase tracking-wider">Ótimo</span>
                          <span className="text-lg font-black text-slate-800">{globalStats.counts.otimo}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${(globalStats.counts.otimo / data.length) * 100}%` }}
                            className="h-full bg-psf-blue"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-end">
                          <span className="text-[10px] font-black text-psf-green uppercase tracking-wider">Bom</span>
                          <span className="text-lg font-black text-slate-800">{globalStats.counts.bom}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${(globalStats.counts.bom / data.length) * 100}%` }}
                            className="h-full bg-psf-green"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-end">
                          <span className="text-[10px] font-black text-psf-yellow uppercase tracking-wider">Suficiente</span>
                          <span className="text-lg font-black text-slate-800">{globalStats.counts.suficiente}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${(globalStats.counts.suficiente / data.length) * 100}%` }}
                            className="h-full bg-psf-yellow"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between items-end">
                          <span className="text-[10px] font-black text-psf-red uppercase tracking-wider">Regular</span>
                          <span className="text-lg font-black text-slate-800">{globalStats.counts.regular}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${(globalStats.counts.regular / data.length) * 100}%` }}
                            className="h-full bg-psf-red"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Podium Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Trophy className="text-psf-yellow" />
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-[0.2em]">Pódio de Excelência</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {top3.map((team, index) => (
                      <motion.div
                        key={team['NOME DA EQUIPE']}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.1 }}
                        className={cn(
                          "glass-card p-6 flex flex-col items-center text-center space-y-4 relative overflow-hidden",
                          getClassificationStyle(team['Classificação (CVAT)']).status,
                          index === 0 && "ring-2 ring-psf-blue/30"
                        )}
                      >
                        <div className="absolute top-0 right-0 w-24 h-24 -mr-8 -mt-8 bg-white/20 rounded-full blur-2xl" />
                        <div className="text-5xl drop-shadow-sm">
                          {index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}
                        </div>
                        <div>
                          <h3 className="font-black text-lg leading-tight tracking-tight">{team['NOME DA EQUIPE']}</h3>
                          <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mt-1">{team['Classificação (CVAT)']}</p>
                        </div>
                        <div className="bg-white/60 backdrop-blur-sm px-6 py-2 rounded-2xl border border-white/40 shadow-sm">
                          <span className="text-3xl font-black tracking-tighter">{team['Resultado (CVAT)']}</span>
                          <span className="text-[10px] font-black ml-1 uppercase opacity-50">CVAT</span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </section>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Ranking Table */}
                  <div className="lg:col-span-2 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="text-psf-blue" />
                        <h2 className="text-sm font-black text-slate-800 uppercase tracking-[0.2em]">Ranking de Equipes</h2>
                      </div>
                      <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-3 py-1.5 rounded-lg uppercase tracking-widest">
                        {data.length} Unidades
                      </span>
                    </div>
                    <div className="glass-card overflow-hidden border-slate-100">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-100">
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Pos</th>
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipe</th>
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Desempenho</th>
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.map((team, index) => (
                              <tr 
                                key={team['NOME DA EQUIPE']} 
                                className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors cursor-default group"
                              >
                                <td className="px-6 py-4">
                                  <span className={cn(
                                    "w-7 h-7 flex items-center justify-center rounded-lg text-xs font-black shadow-sm",
                                    index < 3 ? "bg-psf-blue text-white" : "bg-slate-100 text-slate-500"
                                  )}>
                                    {index + 1}
                                  </span>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="font-bold text-slate-700">{team['NOME DA EQUIPE']}</div>
                                  <div className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">Unidade de Saúde da Família</div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-20 bg-slate-100 h-2 rounded-full overflow-hidden">
                                      <div 
                                        className="bg-psf-blue h-full transition-all duration-1000" 
                                        style={{ width: `${Math.min((team['Resultado (CVAT)'] / (top3[0]?.['Resultado (CVAT)'] || 1)) * 100, 100)}%` }}
                                      />
                                    </div>
                                    <span className="font-black text-slate-800 tracking-tighter">{team['Resultado (CVAT)']}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <span className={cn(
                                    "text-[9px] font-black px-3 py-1.5 rounded-lg uppercase tracking-widest shadow-sm border",
                                    getClassificationStyle(team['Classificação (CVAT)']).badge,
                                    getClassificationStyle(team['Classificação (CVAT)']).status
                                  )}>
                                    {team['Classificação (CVAT)']}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Sidebar: SWOT & Chat */}
                  <div className="space-y-8">
                    {/* SWOT Analysis */}
                    <section className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Target className="text-psf-red" />
                        <h2 className="text-sm font-black text-slate-800 uppercase tracking-[0.2em]">Diagnóstico 360</h2>
                      </div>
                      <div className="glass-card p-6 space-y-5 border-psf-red/10">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipe em Foco</label>
                          <select 
                            value={selectedTeam}
                            onChange={(e) => setSelectedTeam(e.target.value)}
                            className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-psf-blue transition-all appearance-none cursor-pointer"
                          >
                            {data.map(team => (
                              <option key={team['NOME DA EQUIPE']} value={team['NOME DA EQUIPE']}>
                                {team['NOME DA EQUIPE']}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button 
                          onClick={generateSWOT}
                          disabled={analyzing}
                          className="w-full flex items-center justify-center gap-3 bg-slate-900 hover:bg-black text-white py-4 rounded-2xl font-bold transition-all disabled:opacity-50 shadow-lg active:scale-95"
                        >
                          {analyzing ? (
                            <>
                              <Loader2 className="animate-spin" size={18} />
                              Processando...
                            </>
                          ) : (
                            <>
                              <RefreshCw size={18} />
                              Gerar Matriz SWOT
                            </>
                          )}
                        </button>

                        {swotAnalysis && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-5 bg-slate-50 rounded-2xl border border-slate-100"
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-1.5 h-4 bg-psf-blue rounded-full" />
                              <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">Análise Estratégica</h4>
                            </div>
                            <div className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto pr-3 custom-scrollbar font-medium">
                              {swotAnalysis}
                            </div>
                          </motion.div>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              </>
            ) : (
              /* Nominal List View */
              <section className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="glass-card p-5 bg-gradient-to-br from-white to-psf-blue/5">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total de Cidadãos</p>
                    <p className="text-3xl font-black text-slate-800">{nominalStats.total}</p>
                  </div>
                  <div className="glass-card p-5 bg-gradient-to-br from-white to-psf-green/5">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Acompanhamento OK</p>
                    <div className="flex items-end gap-2">
                      <p className="text-3xl font-black text-psf-green">{nominalStats.followedUp}</p>
                      <p className="text-xs font-bold text-slate-400 mb-1">({((nominalStats.followedUp / (nominalStats.total || 1)) * 100).toFixed(1)}%)</p>
                    </div>
                  </div>
                  <div className="glass-card p-5 bg-gradient-to-br from-white to-psf-red/5">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Prioridade (Vulneráveis)</p>
                    <p className="text-3xl font-black text-psf-red">{nominalStats.vulnerable}</p>
                  </div>
                  <div className="glass-card p-5 bg-psf-blue/5 border-psf-blue/20 flex flex-col justify-center items-center text-center cursor-pointer hover:bg-psf-blue/10 transition-all group" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="text-psf-blue mb-2 group-hover:scale-110 transition-transform" size={24} />
                    <p className="text-[10px] font-black text-psf-blue uppercase tracking-widest">Atualizar Lista Nominal</p>
                  </div>
                </div>

                {nominalStats.vulnerable > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-psf-red/5 border border-psf-red/10 p-4 rounded-2xl flex items-start gap-4"
                  >
                    <div className="bg-psf-red/10 p-2 rounded-lg">
                      <AlertCircle className="text-psf-red w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-psf-red uppercase tracking-widest">Atenção Prioritária</h4>
                      <p className="text-xs text-slate-600 font-medium mt-1">
                        Identificamos {nominalStats.vulnerable} cidadãos com critérios de vulnerabilidade (Idosos, Crianças, BPC/PBF). 
                        Recomendamos priorizar a busca ativa e o acompanhamento destes casos para fortalecer o vínculo e melhorar o CVAT de acompanhamento.
                      </p>
                    </div>
                  </motion.div>
                )}

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <UserCheck className="text-psf-green" />
                    <h2 className="text-sm font-black text-slate-800 uppercase tracking-[0.2em]">Levantamento Nominal</h2>
                    <div className="group relative">
                      <AlertCircle size={14} className="text-slate-400 cursor-help" />
                      <div className="absolute bottom-full left-0 mb-2 w-64 p-3 bg-slate-800 text-white text-[10px] rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-xl">
                        <p className="font-bold mb-1">Colunas Detectadas para Prioridade:</p>
                        <ul className="list-disc pl-3 space-y-1 opacity-80">
                          <li><b>IDADE:</b> Identifica Idosos (≥60) e Crianças (≤12)</li>
                          <li><b>BPC / PBF:</b> Identifica beneficiários de programas sociais</li>
                          <li><b>GESTANTE:</b> Identifica gestantes para pré-natal</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={downloadNominalCSV}
                      className="flex items-center gap-2 bg-white border-2 border-slate-100 hover:border-psf-green text-slate-600 px-4 py-3 rounded-2xl text-xs font-bold transition-all shadow-sm active:scale-95"
                    >
                      <FileText size={16} className="text-psf-green" />
                      Exportar CSV
                    </button>
                    <div className="relative w-full md:w-48">
                      <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <select 
                        value={ineFilter}
                        onChange={(e) => setIneFilter(e.target.value)}
                        className="w-full bg-white border-2 border-slate-100 rounded-2xl pl-11 pr-4 py-3 text-sm font-bold text-slate-600 focus:outline-none focus:border-psf-blue transition-all shadow-sm appearance-none cursor-pointer"
                      >
                        <option value="">Todos os INEs</option>
                        {Array.from(new Set(nominalData.map(d => d.ine))).filter(ine => ine !== 'Não Informado' && ine !== 'N/A').sort().map(ine => (
                          <option key={ine} value={ine}>INE: {ine}</option>
                        ))}
                      </select>
                    </div>
                    <div className="relative w-full md:w-80">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <input 
                        type="text" 
                        placeholder="Buscar por Nome, CPF ou Equipe..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white border-2 border-slate-100 rounded-2xl pl-11 pr-4 py-3 text-sm font-medium focus:outline-none focus:border-psf-blue transition-all shadow-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-2">Filtrar Prioridades:</span>
                  {['Idoso', 'Criança', 'BPC/PBF', 'Gestante'].map(filter => (
                    <button
                      key={filter}
                      onClick={() => toggleVulnerabilityFilter(filter)}
                      className={cn(
                        "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2",
                        vulnerabilityFilters.includes(filter)
                          ? "bg-psf-red text-white border-psf-red shadow-md scale-105"
                          : "bg-white text-slate-500 border-slate-100 hover:border-psf-red/30"
                      )}
                    >
                      {filter}
                    </button>
                  ))}
                  {vulnerabilityFilters.length > 0 && (
                    <button 
                      onClick={() => setVulnerabilityFilters([])}
                      className="text-[10px] font-bold text-psf-red hover:underline ml-2"
                    >
                      Limpar Filtros
                    </button>
                  )}
                </div>

                <div className="glass-card overflow-hidden border-slate-100 shadow-lg">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100/50 border-b-2 border-slate-200">
                          <th className="px-6 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest border-r border-slate-200/50">CPF</th>
                          <th className="px-6 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest border-r border-slate-200/50">Cidadão</th>
                          <th className="px-6 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest border-r border-slate-200/50">INE</th>
                          <th className="px-6 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest border-r border-slate-200/50">Equipe Responsável</th>
                          <th className="px-6 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest border-r border-slate-200/50">Vulnerabilidade</th>
                          <th className="px-6 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest border-r border-slate-200/50">Status</th>
                          <th className="px-6 py-5 text-[10px] font-black text-slate-500 uppercase tracking-widest">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredNominal.length > 0 ? (
                          filteredNominal.map((item, index) => (
                            <tr key={index} className="even:bg-slate-50/40 hover:bg-psf-blue/5 transition-colors group">
                              <td className="px-6 py-4 font-mono text-xs text-slate-500 border-r border-slate-100/50">{item.cpf}</td>
                              <td className="px-6 py-4 border-r border-slate-100/50">
                                <p className="font-bold text-slate-700 group-hover:text-psf-blue transition-colors">{item.nome}</p>
                              </td>
                              <td className="px-6 py-4 text-xs font-black text-psf-blue border-r border-slate-100/50">{item.ine}</td>
                              <td className="px-6 py-4 text-xs font-medium text-slate-500 uppercase border-r border-slate-100/50">{item.equipe}</td>
                              <td className="px-6 py-4 border-r border-slate-100/50">
                                <span className={cn(
                                  "text-[10px] font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 w-fit shadow-sm",
                                  item.isPriority ? "bg-psf-red/10 text-psf-red border border-psf-red/20" : "bg-slate-100 text-slate-500 border border-slate-200"
                                )}>
                                  {item.isPriority && <AlertCircle size={12} />}
                                  {item.vulnerabilidade}
                                </span>
                              </td>
                              <td className="px-6 py-4 border-r border-slate-100/50">
                                <span className={cn(
                                  "text-[9px] font-black px-3 py-2 rounded-xl uppercase tracking-widest border shadow-sm inline-block",
                                  item.status.toLowerCase().includes('ok') || item.status.toLowerCase().includes('concluído') 
                                    ? "bg-green-50 text-green-700 border-green-200" 
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                )}>
                                  {item.status}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <button 
                                    onClick={() => toggleFollowUp(index)}
                                    className={cn(
                                      "p-2.5 rounded-xl transition-all active:scale-95 border shadow-sm",
                                      item.status.toLowerCase().includes('ok') || item.status.toLowerCase().includes('concluído')
                                        ? "text-slate-400 hover:text-psf-red bg-white border-slate-100 hover:border-psf-red/20"
                                        : "text-psf-green hover:bg-psf-green/10 bg-white border-slate-100 hover:border-psf-green/20"
                                    )}
                                    title={item.status.toLowerCase().includes('ok') ? "Remover Acompanhamento" : "Marcar como Acompanhado"}
                                  >
                                    {item.status.toLowerCase().includes('ok') ? <RefreshCw size={18} /> : <UserCheck size={18} />}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={7} className="px-6 py-24 text-center">
                              <div className="flex flex-col items-center gap-3">
                                <Search size={40} className="text-slate-200" />
                                <p className="text-slate-400 font-medium">Nenhum registro encontrado para "{searchTerm}" {ineFilter && `no INE ${ineFilter}`}</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Global Chat Floating Button/Panel */}
            <div className="fixed bottom-8 right-8 z-50">
              <div className="relative group">
                <div className="absolute -top-2 -right-2 w-5 h-5 bg-psf-red rounded-full border-2 border-white animate-pulse" />
                <button 
                  onClick={() => {
                    const chatPanel = document.getElementById('ai-chat-panel');
                    chatPanel?.classList.toggle('hidden');
                  }}
                  className="bg-psf-blue text-white p-4 rounded-2xl shadow-2xl hover:scale-110 transition-all active:scale-95"
                >
                  <MessageSquare size={24} />
                </button>
              </div>

              <div id="ai-chat-panel" className="hidden absolute bottom-20 right-0 w-96 glass-card flex flex-col h-[500px] shadow-2xl border-psf-blue/20 overflow-hidden">
                <div className="bg-psf-blue p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="text-white w-5 h-5" />
                    <h3 className="text-white font-black text-xs uppercase tracking-widest">Mentor SIAPS 360</h3>
                  </div>
                  <button 
                    onClick={() => document.getElementById('ai-chat-panel')?.classList.add('hidden')}
                    className="text-white/70 hover:text-white"
                  >
                    <ChevronRight className="rotate-90" size={20} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-white/50">
                  {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                      <div className="bg-psf-blue/10 p-4 rounded-full">
                        <Users className="text-psf-blue w-8 h-8" />
                      </div>
                      <p className="text-xs text-slate-500 font-medium">Olá! Sou seu mentor de gestão. Como posso ajudar com os índices da sua equipe hoje?</p>
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        "max-w-[85%] p-4 rounded-2xl text-xs leading-relaxed",
                        msg.role === 'user' 
                          ? "bg-psf-blue text-white ml-auto rounded-tr-none shadow-md" 
                          : "bg-white text-slate-700 mr-auto rounded-tl-none shadow-sm border border-slate-100"
                      )}
                    >
                      {msg.content}
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="bg-white text-slate-700 mr-auto p-4 rounded-2xl rounded-tl-none text-xs shadow-sm border border-slate-100">
                      <Loader2 className="animate-spin" size={16} />
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
                <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-slate-100 flex gap-2">
                  <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Pergunte sobre vínculo..."
                    className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-2.5 text-xs font-medium focus:outline-none focus:border-psf-blue transition-all"
                  />
                  <button 
                    type="submit"
                    disabled={!input.trim() || chatLoading}
                    className="bg-psf-blue hover:bg-blue-700 text-white p-2.5 rounded-xl transition-all disabled:opacity-50 shadow-md"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </div>
          </>
        )}
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </div>
  );
}
