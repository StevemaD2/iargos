
import { GoogleGenAI, Type } from "@google/genai";
import { Submission, UserRole } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const analyzeSubmissions = async (submissions: Submission[], role: UserRole) => {
  const model = role === UserRole.DIRECTOR ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';
  
  const prompt = `
    Como Analista de Inteligência Política, analise os seguintes dados coletados em campo:
    ${JSON.stringify(submissions.map(s => ({
      type: s.type,
      text: s.content,
      interaction: s.voterInteraction,
      bairro: s.locationDetails.bairro
    })))}

    Instruções para o nível: ${role}
    1. Gere um resumo executivo.
    2. Identifique os 5 temas mais urgentes.
    3. Se for Diretor, crie um "Briefing do Candidato" com tom recomendado, 5 tópicos principais, 3 riscos e 3 oportunidades.
    4. Responda em formato JSON.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            topThemes: { type: Type.ARRAY, items: { type: Type.STRING } },
            candidateBriefing: {
              type: Type.OBJECT,
              properties: {
                recommendedTone: { type: Type.STRING },
                keyTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
                suggestedResponses: { type: Type.ARRAY, items: { type: Type.STRING } },
                risks: { type: Type.ARRAY, items: { type: Type.STRING } },
                opportunities: { type: Type.ARRAY, items: { type: Type.STRING } }
              }
            }
          }
        }
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("Gemini Error:", error);
    return null;
  }
};
