import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { auth, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const db = getFirestore();

export default function App() {
  const [messages, setMessages] = useState([
    { role: 'system', content: 'És o DizAI, um assistente útil que responde em português de Portugal.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState('openai/gpt-oss-20b');
  const [user, setUser] = useState(null);
  const [historico, setHistorico] = useState([]);
  
  // NOVO: Referência para o AbortController
  const abortControllerRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setHistorico([]);
      return;
    }
    const q = query(
      collection(db, 'conversas', user.uid, 'mensagens'),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => doc.data());
      setHistorico(msgs);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, historico]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Erro no login:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const systemMessage = messages.find(m => m.role === 'system');
    const recentMessages = messages.filter(m => m.role !== 'system').slice(-6);
    const newMessages = [
      ...(systemMessage ? [systemMessage] : []),
      ...recentMessages,
      { role: 'user', content: input }
    ];

    setMessages(prev => [...prev, { role: 'user', content: input }]);
    
    if (user) {
      await addDoc(collection(db, 'conversas', user.uid, 'mensagens'), {
        role: 'user',
        content: input,
        createdAt: serverTimestamp(),
      });
    }

    setInput('');
    setLoading(true);

    // NOVO: Criar o AbortController para este pedido
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, model }),
        signal: signal, // NOVO: Passar o signal para o fetch
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                assistantMessage += data.text;
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: assistantMessage };
                  return updated;
                });
              }
            } catch (e) {}
          }
        }
      }

      if (user && assistantMessage) {
        await addDoc(collection(db, 'conversas', user.uid, 'mensagens'), {
          role: 'assistant',
          content: assistantMessage,
          createdAt: serverTimestamp(),
        });
      }

    } catch (error) {
      // NOVO: Se o erro for por abortar, não mostrar mensagem de erro
      if (error.name === 'AbortError') {
        console.log('Geração cancelada pelo utilizador.');
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `❌ Erro: ${error.message}` }]);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const todasAsMensagens = [
    ...historico,
    ...messages.filter(m => m.role !== 'system')
  ];

  return (
    <div className="app">
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1>💬 DizAI</h1>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="model-select">
            <option value="openai/gpt-oss-20b">GPT-OSS 20B (rápido)</option>
            <option value="openai/gpt-oss-120b">GPT-OSS 120B (inteligente)</option>
          </select>
        </div>
        
        <div>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
              <img src={user.photoURL} alt="Avatar" style={{ width: 32, height: 32, borderRadius: '50%' }} />
              <span style={{ fontSize: '0.9rem' }}>{user.displayName}</span>
              <button onClick={handleLogout} className="btn-theme" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>Sair</button>
            </div>
          ) : (
            <button onClick={handleLogin} className="btn-theme" style={{ padding: '0.6rem 1rem' }}>🔑 Entrar com Google</button>
          )}
        </div>
      </header>

      <main className="chat-window">
        {todasAsMensagens.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="avatar">{msg.role === 'user' ? '👤' : '🤖'}</div>
            <div className="bubble">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          </div>
        ))}
        {loading && (
          <div className="message assistant">
            <div className="avatar">🤖</div>
            <div className="bubble typing"><span></span><span></span><span></span></div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Diz aí... (Enter para enviar)"
          rows={1}
        />
        
        {/* NOVO: Se estiver a carregar, mostra o botão de Parar. Senão, mostra o de Enviar */}
        {loading ? (
          <button 
            onClick={stopGeneration}
            style={{ background: '#e74c3c', padding: '0 1rem' }}
            title="Parar geração"
          >
            ⏹
          </button>
        ) : (
          <button onClick={sendMessage} disabled={!input.trim()}>
            ➤
          </button>
        )}
      </footer>
    </div>
  );
}