import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Configuração de CORS explícita para aceitar o Vercel e o localhost
const allowedOrigins = [
  'http://localhost:5173',
  'https://dizai-nu.vercel.app' // O teu domínio no Vercel
  'https://dizai-frontend.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    // Permite pedidos sem origin (ex: ferramentas de teste) ou se estiver na lista
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

console.log("🔑 Chave Groq detetada:", process.env.GROQ_API_KEY ? "SIM" : "NÃO");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Rota do Chat (Streaming via SSE)
app.post('/api/chat', async (req, res) => {
  const { messages, model = 'openai/gpt-oss-20b' } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    console.log("🤖 Pedido recebido. Modelo:", model);
    
    const stream = await groq.chat.completions.create({
      model: model,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
    console.log("✅ Resposta enviada com sucesso.");
  } catch (error) {
    console.error("❌ ERRO NO BACKEND:", error.message);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
  } finally {
    res.end();
  }
});

// Rota de health check (para o Render não dar erro na página inicial)
app.get('/', (req, res) => {
  res.send('🚀 DizAI Backend está online!');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 DizAI server a correr na porta ${PORT}`));