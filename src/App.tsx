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
  Target
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SIAPSData, Message } from './types';
import { cn } from './lib/utils';

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

Use uma linguagem acolhedora, técnica e motivadora. Explique que o cadastro territorializa e identifica, enquanto o acompanhamento consolida a continuidade do cuidado.`;

const getClassificationRank = (classification: string) => {
  const c = classification.toUpperCase();
  if (c.includes('ÓTIMO')) return 4;
  if (c.includes('BOM')) return 3;
  if (c.includes('REGULAR')) return 2;
  if (c.includes('SUFICIENTE')) return 1;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [swotAnalysis, setSwotAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  
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
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsedData = results.data.map((row: any) => {
            // Handle decimal comma if present
            const rawResult = row['Resultado (CVAT)'] || '0';
            const resultValue = typeof rawResult === 'string' 
              ? parseFloat(rawResult.replace(',', '.')) 
              : parseFloat(rawResult);
            
            return {
              ...row,
              'Resultado (CVAT)': isNaN(resultValue) ? 0 : resultValue,
              'NOME DA EQUIPE': row['NOME DA EQUIPE'] || 'Equipe Sem Nome',
              'Classificação  (CVAT)': row['Classificação  (CVAT)'] || 'N/A'
            };
          }).filter(item => item['NOME DA EQUIPE'] !== 'Equipe Sem Nome');

          if (parsedData.length === 0) {
            throw new Error('Nenhum dado válido encontrado no arquivo.');
          }

          // Sort by classification rank first, then by numerical result
          const sortedData = parsedData.sort((a, b) => {
            const rankA = getClassificationRank(a['Classificação  (CVAT)']);
            const rankB = getClassificationRank(b['Classificação  (CVAT)']);
            
            if (rankA !== rankB) return rankB - rankA;
            return b['Resultado (CVAT)'] - a['Resultado (CVAT)'];
          });

          setData(sortedData);
          setSelectedTeam(sortedData[0]['NOME DA EQUIPE']);
          setLoading(false);
        } catch (err) {
          setError('Erro ao processar o arquivo. Verifique o formato do CSV.');
          setLoading(false);
        }
      },
      error: (err) => {
        setError('Erro ao ler o arquivo.');
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
      - Classificação: ${teamData?.['Classificação  (CVAT)']}
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

  const top3 = data.slice(0, 3);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Activity className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Realidade Inteligente - Gestão</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm"
            >
              <Upload size={16} />
              Carregar Relatório
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
            <div className="bg-blue-50 p-6 rounded-full">
              <FileText className="w-16 h-16 text-blue-500" />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-2xl font-bold text-slate-800">Boas-vindas ao Painel SIAPS</h2>
              <p className="text-slate-500">Faça o upload do relatório CSV do SIAPS para visualizar o ranking de desempenho e obter consultoria estratégica.</p>
            </div>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 bg-white border border-slate-200 hover:border-blue-300 text-slate-700 px-6 py-3 rounded-xl font-medium transition-all shadow-sm"
            >
              <Upload size={20} className="text-blue-500" />
              Selecionar arquivo CSV
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
            {/* Podium Section */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Trophy className="text-amber-500" />
                <h2 className="text-lg font-bold text-slate-800 uppercase tracking-wider">Pódio das Equipes</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {top3.map((team, index) => (
                  <motion.div
                    key={team['NOME DA EQUIPE']}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.1 }}
                    className={cn(
                      "glass-card p-6 flex flex-col items-center text-center space-y-4",
                      getClassificationStyle(team['Classificação  (CVAT)']).status,
                      index === 0 && "ring-2 ring-blue-400"
                    )}
                  >
                    <div className="text-4xl">
                      {index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}
                    </div>
                    <div>
                      <h3 className="font-bold text-lg leading-tight">{team['NOME DA EQUIPE']}</h3>
                      <p className="text-sm opacity-70">{team['Classificação  (CVAT)']}</p>
                    </div>
                    <div className="bg-white/50 px-4 py-2 rounded-full">
                      <span className="text-2xl font-black">{team['Resultado (CVAT)']}</span>
                      <span className="text-xs font-bold ml-1 uppercase">pts</span>
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
                    <TrendingUp className="text-blue-500" />
                    <h2 className="text-lg font-bold text-slate-800 uppercase tracking-wider">Ranking Geral</h2>
                  </div>
                  <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded uppercase">
                    {data.length} Equipes
                  </span>
                </div>
                <div className="glass-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Pos</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Equipe</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Resultado</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Classificação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.map((team, index) => (
                          <tr 
                            key={team['NOME DA EQUIPE']} 
                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-default group"
                          >
                            <td className="px-6 py-4">
                              <span className={cn(
                                "w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold",
                                index < 3 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                              )}>
                                {index + 1}
                              </span>
                            </td>
                            <td className="px-6 py-4 font-semibold text-slate-700">{team['NOME DA EQUIPE']}</td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div className="w-16 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                  <div 
                                    className="bg-blue-500 h-full" 
                                    style={{ width: `${Math.min((team['Resultado (CVAT)'] / (top3[0]?.['Resultado (CVAT)'] || 1)) * 100, 100)}%` }}
                                  />
                                </div>
                                <span className="font-mono font-bold">{team['Resultado (CVAT)']}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "text-[10px] font-bold px-2 py-1 rounded uppercase",
                                getClassificationStyle(team['Classificação  (CVAT)']).badge
                              )}>
                                {team['Classificação  (CVAT)']}
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
                    <Target className="text-purple-500" />
                    <h2 className="text-lg font-bold text-slate-800 uppercase tracking-wider">Análise SWOT</h2>
                  </div>
                  <div className="glass-card p-6 space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase">Selecione a Equipe</label>
                      <select 
                        value={selectedTeam}
                        onChange={(e) => setSelectedTeam(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
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
                      className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white py-3 rounded-xl font-medium transition-all disabled:opacity-50"
                    >
                      {analyzing ? (
                        <>
                          <Loader2 className="animate-spin" size={18} />
                          Analisando...
                        </>
                      ) : (
                        <>
                          <RefreshCw size={18} />
                          Gerar Diagnóstico
                        </>
                      )}
                    </button>

                    {swotAnalysis && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="p-4 bg-blue-50 rounded-xl border border-blue-100"
                      >
                        <h4 className="text-sm font-bold text-blue-800 mb-2">Diagnóstico: {selectedTeam}</h4>
                        <div className="text-xs text-blue-700 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                          {swotAnalysis}
                        </div>
                      </motion.div>
                    )}
                  </div>
                </section>

                {/* AI Chat */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="text-blue-500" />
                    <h2 className="text-lg font-bold text-slate-800 uppercase tracking-wider">Consultor AI</h2>
                  </div>
                  <div className="glass-card flex flex-col h-[500px]">
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                      {messages.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                          <div className="bg-slate-100 p-3 rounded-full">
                            <Users className="text-slate-400" />
                          </div>
                          <p className="text-sm text-slate-500">Tire suas dúvidas sobre gestão e como melhorar os índices da sua equipe.</p>
                        </div>
                      )}
                      {messages.map((msg, i) => (
                        <div 
                          key={i} 
                          className={cn(
                            "max-w-[85%] p-3 rounded-2xl text-sm",
                            msg.role === 'user' 
                              ? "bg-blue-600 text-white ml-auto rounded-tr-none" 
                              : "bg-slate-100 text-slate-700 mr-auto rounded-tl-none"
                          )}
                        >
                          {msg.content}
                        </div>
                      ))}
                      {chatLoading && (
                        <div className="bg-slate-100 text-slate-700 mr-auto p-3 rounded-2xl rounded-tl-none text-sm">
                          <Loader2 className="animate-spin" size={16} />
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                    <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-100 flex gap-2">
                      <input 
                        type="text" 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Como melhorar o vínculo?"
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <button 
                        type="submit"
                        disabled={!input.trim() || chatLoading}
                        className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-full transition-all disabled:opacity-50"
                      >
                        <Send size={18} />
                      </button>
                    </form>
                  </div>
                </section>
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
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
}
