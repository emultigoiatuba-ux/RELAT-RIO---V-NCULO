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
  ClipboardList,
  Baby,
  Wallet,
  User,
  X,
  Calendar,
  Map
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SIAPSData, Message } from './types';
import { cn } from './lib/utils';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

const SYSTEM_INSTRUCTION = `Você é um Consultor Especialista em Gestão da Atenção Primária à Saúde, com profundo conhecimento da Nota Técnica Nº 30/2025-CGESCO/DESCO/SAPS/MS. 

Seu objetivo é analisar os dados do SIAPS (vínculo e acompanhamento) e fornecer orientações práticas baseadas na metodologia oficial:

1. **Metodologia de Cálculo (CVAT)**:
   - **Dimensão Cadastro (30%)**: Valoriza a completude. Fator 0.75 para cadastro individual (MICI) e 1.5 para cadastro completo (MICI + Domiciliar/Territorial - MICDT). O 'Total Cadastro' é a soma de MICI e MICDT. Cadastros devem estar atualizados nos últimos 24 meses.
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

const getLimiteNormativo = (porte: number, teamName: string) => {
  const name = teamName.toUpperCase();
  const isEAP30 = name.includes('EAP 30') || name.includes('EAP30');
  const isEAP20 = name.includes('EAP 20') || name.includes('EAP20');
  const isEAP = name.includes('EAP') && !isEAP30 && !isEAP20;
  
  if (porte === 1) {
    if (isEAP20) return 1000;
    if (isEAP30 || isEAP) return 1500;
    return 2000;
  }
  if (porte === 2) {
    if (isEAP20) return 1250;
    if (isEAP30 || isEAP) return 1875;
    return 2500;
  }
  if (porte === 3) {
    if (isEAP20) return 1375;
    if (isEAP30 || isEAP) return 2063;
    return 2750;
  }
  if (isEAP20) return 1500;
  if (isEAP30 || isEAP) return 2250;
  return 3000;
};

const getClassificationRank = (classification: string | undefined) => {
  if (!classification) return 0;
  const c = classification.toUpperCase();
  if (c.includes('ÓTIMO') || c.includes('ÓTIMA')) return 4;
  if (c.includes('BOM') || c.includes('BOA')) return 3;
  if (c.includes('SUFICIENTE')) return 2;
  if (c.includes('REGULAR')) return 1;
  return 0;
};

const getClassificationStyle = (classification: string | undefined) => {
  if (!classification) return { badge: 'bg-slate-100 text-slate-700', status: 'bg-white' };
  const c = classification.toUpperCase();
  if (c.includes('ÓTIMO') || c.includes('ÓTIMA')) return { badge: 'badge-otimo', status: 'status-otimo' };
  if (c.includes('BOM') || c.includes('BOA')) return { badge: 'badge-bom', status: 'status-bom' };
  if (c.includes('REGULAR')) return { badge: 'badge-regular', status: 'status-regular' };
  if (c.includes('SUFICIENTE')) return { badge: 'badge-suficiente', status: 'status-suficiente' };
  return { badge: 'bg-slate-100 text-slate-700', status: 'bg-white' };
};

export default function App() {
  const [data, setData] = useState<SIAPSData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('Todos');
  const [selectedYear, setSelectedYear] = useState<string>('Todos');
  const [swotAnalysis, setSwotAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [isLinkingSheet, setIsLinkingSheet] = useState(false);
  const [municipalityPorte, setMunicipalityPorte] = useState<number>(2);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchFromGoogleSheets = async () => {
    if (!sheetUrl) return;
    
    setLoading(true);
    setError(null);
    
    try {
      let fetchUrl = sheetUrl.trim();
      
      if (fetchUrl.includes('docs.google.com/spreadsheets')) {
        if (fetchUrl.includes('/d/e/')) {
          // Link de "Publicar na Web"
          fetchUrl = fetchUrl.replace('/pubhtml', '/pub');
          if (!fetchUrl.includes('output=csv')) {
            fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'output=csv';
          }
        } else {
          // Link padrão de edição/visualização
          const match = fetchUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
          if (match && match[1]) {
            fetchUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
          }
        }
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('Não foi possível acessar a planilha. Verifique se ela está "Publicada na Web" como CSV.');
      
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (header) => (header || '').trim().toUpperCase().replace(/\s+/g, ' '),
        complete: (results) => {
          const rawData = results.data as any[];
          if (!rawData || rawData.length === 0) {
            setError('A planilha parece estar vazia.');
            setLoading(false);
            return;
          }

          const headers = Object.keys(rawData[0]);
          const hasEquipe = headers.includes('NOME DA EQUIPE') || headers.includes('EQUIPE');
          const hasResultado = headers.includes('RESULTADO (CVAT)');

          if (hasEquipe && hasResultado) {
            const parsedData = rawData.map((row: any) => {
              const rawResult = row['RESULTADO (CVAT)'] || '0';
              const resultValue = typeof rawResult === 'string' 
                ? parseFloat(rawResult.replace(',', '.')) 
                : parseFloat(rawResult);
              
              const findValue = (term: string) => {
                const key = Object.keys(row).find(k => k.includes(term));
                const val = key ? parseFloat(String(row[key] || '0').replace(',', '.')) : 0;
                return isNaN(val) ? 0 : val;
              };

              const mici = findValue('MICI');
              const micdt = findValue('MICDT');
              const teamName = (row['NOME DA EQUIPE'] || row['EQUIPE'] || '').trim();
              
              return {
                ...row,
                'Resultado (CVAT)': isNaN(resultValue) ? 0 : resultValue,
                'NOME DA EQUIPE': teamName,
                'Classificação (CVAT)': row['CLASSIFICAÇÃO (CVAT)'] || row['CLASSIFICAÇÃO'] || 'N/A',
                'Pessoas Acompanhadas': row['PESSOAS ACOMPANHADAS'] || '0',
                'PARÂMETRO POPULACIONAL': row['PARÂMETRO POPULACIONAL'] || '0',
                'Limite Normativo': getLimiteNormativo(municipalityPorte, teamName),
                'MICI': mici,
                'MICDT': micdt,
                'Total Cadastro': mici + micdt,
                'Mês': row['MÊS'] || row['MES'] || 'N/A',
                'Ano': row['ANO'] || 'N/A'
              };
            }).filter(item => item['NOME DA EQUIPE'] !== '' && item['NOME DA EQUIPE'] !== 'Equipe Sem Nome');

            if (parsedData.length === 0) {
              setError('Nenhuma equipe válida encontrada na planilha.');
              setLoading(false);
              return;
            }

            const sortedData = parsedData.sort((a, b) => {
              const rankA = getClassificationRank(a['Classificação (CVAT)']);
              const rankB = getClassificationRank(b['Classificação (CVAT)']);
              if (rankA !== rankB) return rankB - rankA;
              return b['Resultado (CVAT)'] - a['Resultado (CVAT)'];
            });

            setData(sortedData as SIAPSData[]);
            setSelectedTeam(sortedData[0]['NOME DA EQUIPE']);
            setIsLinkingSheet(false);
          } else {
            setError('A planilha não possui as colunas obrigatórias (Equipe e Resultado CVAT).');
          }
          setLoading(false);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar planilha.');
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => (header || '').trim().toUpperCase().replace(/\s+/g, ' '),
      complete: (results) => {
        try {
          const rawData = results.data as any[];
          
          if (!rawData || rawData.length === 0) {
            throw new Error('O arquivo está vazio ou não pôde ser lido.');
          }

          const headers = Object.keys(rawData[0]);
          const hasEquipe = headers.includes('NOME DA EQUIPE') || headers.includes('EQUIPE');
          const hasResultado = headers.includes('RESULTADO (CVAT)');

          if (hasEquipe && hasResultado) {
            const parsedData = rawData.map((row: any) => {
              const rawResult = row['RESULTADO (CVAT)'] || '0';
              const resultValue = typeof rawResult === 'string' 
                ? parseFloat(rawResult.replace(',', '.')) 
                : parseFloat(rawResult);
              
              const findValue = (term: string) => {
                const key = Object.keys(row).find(k => k.includes(term));
                const val = key ? parseFloat(String(row[key] || '0').replace(',', '.')) : 0;
                return isNaN(val) ? 0 : val;
              };

              const mici = findValue('MICI');
              const micdt = findValue('MICDT');
              const teamName = (row['NOME DA EQUIPE'] || row['EQUIPE'] || '').trim();
              
              return {
                ...row,
                'Resultado (CVAT)': isNaN(resultValue) ? 0 : resultValue,
                'NOME DA EQUIPE': teamName,
                'Classificação (CVAT)': row['CLASSIFICAÇÃO (CVAT)'] || row['CLASSIFICAÇÃO'] || 'N/A',
                'Pessoas Acompanhadas': row['PESSOAS ACOMPANHADAS'] || '0',
                'PARÂMETRO POPULACIONAL': row['PARÂMETRO POPULACIONAL'] || '0',
                'Limite Normativo': getLimiteNormativo(municipalityPorte, teamName),
                'MICI': mici,
                'MICDT': micdt,
                'Total Cadastro': mici + micdt,
                'Mês': row['MÊS'] || row['MES'] || 'N/A',
                'Ano': row['ANO'] || 'N/A'
              };
            }).filter(item => item['NOME DA EQUIPE'] !== '' && item['NOME DA EQUIPE'] !== 'Equipe Sem Nome');

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
          } else {
            throw new Error('Formato de colunas não reconhecido. Certifique-se de que o arquivo contém as colunas de Equipe e Resultado (CVAT).');
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
      const totalCadastro = Number(teamData?.['Total Cadastro'] || 0);
      const parametro = Number(teamData?.['Limite Normativo'] || teamData?.['PARÂMETRO POPULACIONAL'] || 0);
      const diff = totalCadastro - parametro;
      const needsRemapping = diff > 0;
      const canReceive = diff < 0;

      const prompt = `Analise os seguintes dados de desempenho da equipe de saúde ${selectedTeam}:
      - Resultado CVAT: ${teamData?.['Resultado (CVAT)']}
      - Classificação: ${teamData?.['Classificação (CVAT)']}
      - Pessoas Acompanhadas: ${teamData?.['Pessoas Acompanhadas'] || 'N/A'}
      - Limite Normativo (Nota Técnica): ${parametro}
      - Total Cadastro (MICI + MICDT): ${totalCadastro}
      ${needsRemapping ? `- ALERTA: Esta equipe ultrapassou o limite populacional em ${diff} pessoas e necessita de remapeamento (retirar pacientes).` : ''}
      ${canReceive ? `- INFORMAÇÃO: Esta equipe está abaixo do limite populacional em ${Math.abs(diff)} pessoas e pode receber novos pacientes para equilibrar a rede.` : ''}
      
      Com base nisso, crie uma Matriz SWOT focada em 'Vínculo e Acompanhamento'.
      ${needsRemapping ? "Inclua o indicativo de remapeamento e a necessidade de direcionar as pessoas excedentes para outras equipes." : ""}
      ${canReceive ? "Inclua a oportunidade de receber novos pacientes para atingir o parâmetro ideal e melhorar o vínculo territorial." : ""}
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

  const filteredData = data.filter(item => {
    const matchesSearch = (item['NOME DA EQUIPE'] || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesMonth = selectedMonth === 'Todos' || item['Mês'] === selectedMonth;
    const matchesYear = selectedYear === 'Todos' || String(item['Ano']) === selectedYear;
    return matchesSearch && matchesMonth && matchesYear;
  });

  const globalStats = {
    avgCVAT: filteredData.length > 0 ? (filteredData.reduce((acc, curr) => acc + (curr['Resultado (CVAT)'] || 0), 0) / filteredData.length).toFixed(2) : 0,
    counts: {
      otimo: filteredData.filter(d => (d['Classificação (CVAT)'] || '').toUpperCase().includes('ÓTIMO')).length,
      bom: filteredData.filter(d => (d['Classificação (CVAT)'] || '').toUpperCase().includes('BOM')).length,
      suficiente: filteredData.filter(d => (d['Classificação (CVAT)'] || '').toUpperCase().includes('SUFICIENTE')).length,
      regular: filteredData.filter(d => (d['Classificação (CVAT)'] || '').toUpperCase().includes('REGULAR')).length,
    }
  };

  const uniqueMonths = Array.from(new Set(data.map(item => item['Mês']).filter(Boolean))).sort();
  const uniqueYears = Array.from(new Set(data.map(item => String(item['Ano'])).filter(Boolean))).sort();

  const top3 = data.slice(0, 3);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative p-2 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <Home className="w-8 h-8 text-psf-blue relative z-10" />
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
        {data.length === 0 ? (
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
              <p className="text-slate-500 text-sm leading-relaxed">Importe seus relatórios do SIAPS ou vincule uma planilha do Google Drive.</p>
            </div>

            {!isLinkingSheet ? (
              <div className="flex flex-col sm:flex-row gap-3">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-3 bg-white border-2 border-slate-200 hover:border-psf-blue text-slate-700 px-8 py-4 rounded-2xl font-bold transition-all shadow-sm group"
                >
                  <Upload size={20} className="text-psf-blue group-hover:scale-110 transition-transform" />
                  Selecionar Relatório
                </button>
                <button 
                  onClick={() => setIsLinkingSheet(true)}
                  className="flex items-center gap-3 bg-psf-blue text-white px-8 py-4 rounded-2xl font-bold transition-all shadow-lg hover:bg-black active:scale-95"
                >
                  <FileText size={20} />
                  Vincular Google Sheets
                </button>
              </div>
            ) : (
              <div className="w-full max-w-lg bg-white p-6 rounded-3xl border-2 border-psf-blue/20 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Vincular Planilha Online</h3>
                  <button onClick={() => setIsLinkingSheet(false)} className="text-slate-400 hover:text-psf-red">
                    <X size={20} />
                  </button>
                </div>
                <div className="space-y-2">
                  <input 
                    type="text" 
                    placeholder="Cole o link da planilha (Publicada na Web como CSV)"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-xl focus:border-psf-blue outline-none text-sm transition-all"
                  />
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Dica: No Google Sheets, vá em Arquivo &gt; Compartilhar &gt; Publicar na Web &gt; Escolha a aba e selecione "Valores separados por vírgula (.csv)".
                  </p>
                </div>
                <button 
                  onClick={fetchFromGoogleSheets}
                  disabled={!sheetUrl || loading}
                  className="w-full bg-psf-blue text-white py-4 rounded-xl font-bold hover:bg-black transition-all disabled:opacity-50"
                >
                  {loading ? 'Sincronizando...' : 'Sincronizar Agora'}
                </button>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
                <AlertCircle size={18} />
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}
          </motion.div>
        ) : (
          <>
            {/* Global Diagnosis Summary */}
            <div className="flex flex-col gap-6">
              <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="glass-card p-4 flex items-center gap-4 border-l-4 border-psf-blue">
                  <div className="bg-psf-blue/10 p-3 rounded-xl">
                    <Activity className="text-psf-blue w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Média CVAT Global</p>
                    <p className="text-xl font-black text-slate-800">{globalStats.avgCVAT}</p>
                  </div>
                </div>
                <div className="glass-card p-4 flex items-center gap-4 border-l-4 border-psf-yellow">
                  <div className="bg-psf-yellow/10 p-3 rounded-xl">
                    <Users className="text-psf-yellow w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total de Equipes</p>
                    <p className="text-xl font-black text-slate-800">{filteredData.length}</p>
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
                            animate={{ width: `${(globalStats.counts.otimo / (filteredData.length || 1)) * 100}%` }}
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
                            animate={{ width: `${(globalStats.counts.bom / (filteredData.length || 1)) * 100}%` }}
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
                            animate={{ width: `${(globalStats.counts.suficiente / (filteredData.length || 1)) * 100}%` }}
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
                            animate={{ width: `${(globalStats.counts.regular / (filteredData.length || 1)) * 100}%` }}
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
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="text-psf-blue" />
                        <h2 className="text-sm font-black text-slate-800 uppercase tracking-[0.2em]">Ranking de Equipes</h2>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="relative w-full md:w-40">
                          <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                          <select 
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                            className="w-full bg-white border-2 border-slate-100 rounded-2xl pl-11 pr-4 py-2.5 text-xs font-bold text-slate-600 focus:outline-none focus:border-psf-blue transition-all shadow-sm appearance-none cursor-pointer"
                          >
                            <option value="Todos">Mês: Todos</option>
                            {uniqueMonths.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                        <div className="relative w-full md:w-32">
                          <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                          <select 
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(e.target.value)}
                            className="w-full bg-white border-2 border-slate-100 rounded-2xl pl-11 pr-4 py-2.5 text-xs font-bold text-slate-600 focus:outline-none focus:border-psf-blue transition-all shadow-sm appearance-none cursor-pointer"
                          >
                            <option value="Todos">Ano: Todos</option>
                            {uniqueYears.map(y => (
                              <option key={y} value={y}>{y}</option>
                            ))}
                          </select>
                        </div>
                        <div className="relative w-full md:w-48 hidden">
                          <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                          <select 
                            value={municipalityPorte}
                            onChange={(e) => setMunicipalityPorte(Number(e.target.value))}
                            className="w-full bg-white border-2 border-slate-100 rounded-2xl pl-11 pr-4 py-2.5 text-xs font-bold text-slate-600 focus:outline-none focus:border-psf-blue transition-all shadow-sm appearance-none cursor-pointer"
                          >
                            <option value={1}>Porte 1: Até 20k</option>
                            <option value={2}>Porte 2: 20k - 50k</option>
                            <option value={3}>Porte 3: 50k - 100k</option>
                            <option value={4}>Porte 4: Acima 100k</option>
                          </select>
                        </div>
                        <div className="relative w-full md:w-64">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                          <input 
                            type="text" 
                            placeholder="Buscar equipe..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white border-2 border-slate-100 rounded-2xl pl-11 pr-4 py-2.5 text-xs font-medium focus:outline-none focus:border-psf-blue transition-all shadow-sm"
                          />
                        </div>
                        <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-3 py-1.5 rounded-lg uppercase tracking-widest">
                          {filteredData.length} Unidades
                        </span>
                      </div>
                    </div>
                    <div className="glass-card overflow-hidden border-slate-100">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-100">
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Pos</th>
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipe</th>
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Acompanhadas</th>
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Cadastro</th>
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                <div className="flex items-center gap-1 group relative">
                                  Limite Máximo
                                  <Info className="w-3 h-3 text-slate-300 cursor-help" />
                                  <div className="absolute bottom-full left-0 mb-2 px-2 py-1 bg-slate-900 text-white text-[8px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none normal-case tracking-normal">
                                    Capacidade máxima permitida pela NT 30/2025
                                  </div>
                                </div>
                              </th>
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Parâmetro</th>
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">CVAT</th>
                              <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredData.map((team, index) => (
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
                                  <div className="flex items-center gap-2">
                                    <div className="font-bold text-slate-700">{team['NOME DA EQUIPE']}</div>
                                    {(() => {
                                      const total = Number(team['Total Cadastro']);
                                      const limit = Number(team['Limite Normativo'] || team['PARÂMETRO POPULACIONAL']);
                                      const diff = total - limit;
                                      
                                      if (diff > 0) {
                                        return (
                                          <div className="group relative">
                                            <Map className="w-3.5 h-3.5 text-psf-red animate-pulse" />
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[8px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                                              Retirar: {diff} pessoas (Excesso)
                                            </div>
                                          </div>
                                        );
                                      } else if (diff < 0) {
                                        return (
                                          <div className="group relative">
                                            <Map className="w-3.5 h-3.5 text-emerald-500" />
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 text-white text-[8px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                                              Receber: {Math.abs(diff)} pessoas (Vaga)
                                            </div>
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">Unidade de Saúde da Família</div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="text-xs font-bold text-slate-600">{team['Pessoas Acompanhadas']}</div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="text-xs font-bold text-slate-600">{team['Total Cadastro']}</div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex flex-col">
                                    <span className="text-xs font-black text-psf-blue">{team['Limite Normativo']}</span>
                                    <span className="text-[8px] text-slate-400 font-bold uppercase tracking-tighter">Pessoas</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="text-xs font-bold text-slate-600">{team['PARÂMETRO POPULACIONAL']}</div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
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
                            {filteredData.map(team => (
                              <option key={team['NOME DA EQUIPE']} value={team['NOME DA EQUIPE']}>
                                {team['NOME DA EQUIPE']}
                              </option>
                            ))}
                          </select>
                        </div>

                        {selectedTeam && (() => {
                          const team = data.find(t => t['NOME DA EQUIPE'] === selectedTeam);
                          const total = Number(team?.['Total Cadastro'] || 0);
                          const param = Number(team?.['Limite Normativo'] || team?.['PARÂMETRO POPULACIONAL'] || 0);
                          const needsRemap = total > param;
                          const excess = total - param;

                          return (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Acompanhadas</p>
                                  <p className="text-sm font-black text-slate-800">{team?.['Pessoas Acompanhadas']}</p>
                                </div>
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Cadastro</p>
                                  <p className="text-sm font-black text-slate-800">{total}</p>
                                </div>
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Limite Máximo</p>
                                  <p className="text-sm font-black text-psf-blue">{param}</p>
                                </div>
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Resultado CVAT</p>
                                  <p className="text-sm font-black text-psf-blue">{team?.['Resultado (CVAT)']}</p>
                                </div>
                              </div>
                              
                              {needsRemap && (
                                <div className="bg-psf-red/5 border border-psf-red/20 p-3 rounded-xl flex items-start gap-3">
                                  <div className="bg-psf-red/10 p-2 rounded-lg">
                                    <Map className="text-psf-red w-4 h-4" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-black text-psf-red uppercase tracking-widest">Remapeamento: Retirar</p>
                                    <p className="text-xs font-bold text-slate-700 mt-0.5">
                                      Excesso de {excess} pessoas.
                                    </p>
                                  </div>
                                </div>
                              )}

                              {total < param && (
                                <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl flex items-start gap-3">
                                  <div className="bg-emerald-100 p-2 rounded-lg">
                                    <Map className="text-emerald-600 w-4 h-4" />
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Remapeamento: Receber</p>
                                    <p className="text-xs font-bold text-slate-700 mt-0.5">
                                      Vaga para {param - total} pessoas.
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

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
