import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { auth, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { 
  getFirestore, collection, query, orderBy, onSnapshot, 
  addDoc, serverTimestamp, doc, setDoc, updateDoc, deleteDoc 
} from 'firebase/firestore';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const db = getFirestore();

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState('openai/gpt-oss-20b');
  const [user, setUser] = useState(null);
  
  const [chats, setChats] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  const abortControllerRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => setUser(currentUser));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setChats([]);
      return;
    }
    const q = query(collection(db, 'conversas', user.uid, 'chats'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChats(chatList);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || !currentChatId) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, 'conversas', user.uid, 'chats', currentChatId, 'mensagens'),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => doc.data());
      setMessages(msgs);
    });
    return () => unsubscribe();
  }, [user, currentChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleLogin = async () => {
    try { await signInWithPopup(auth, googleProvider); } catch (e) { console.error(e); }
  };
  const handleLogout = () => signOut(auth);

  const createNewChat = async () => {
    if (!user) return;
    const newChatRef = doc(collection(db, 'conversas', user.uid, 'chats'));
    await setDoc(newChatRef, {
      title: 'Nova Conversa',
      createdAt: serverTimestamp()
    });
    setCurrentChatId(newChatRef.id);
    setMessages([]);
    setSidebarOpen(false);
  };

  const deleteChat = async (e, chatId) => {
    e.stopPropagation();
    if (!user) return;
    await deleteDoc(doc(db, 'conversas', user.uid, 'chats', chatId));
    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setMessages([]);
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    let chatId = currentChatId;
    if (!chatId) {
      const newChatRef = doc(collection(db, 'conversas', user.uid, 'chats'));
      await setDoc(newChatRef, {
        title: 'Nova Conversa',
        createdAt: serverTimestamp()
      });
      chatId = newChatRef.id;
      setCurrentChatId(chatId);
    }

    const currentChat = chats.find(c => c.id === chatId);
    if (currentChat && currentChat.title === 'Nova Conversa') {
      await updateDoc(doc(db, 'conversas', user.uid, 'chats', chatId), {
        title: input.substring(0, 30) + (input.length > 30 ? '...' : '')
      });
    }

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    
    if (user) {
      await addDoc(collection(db, 'conversas', user.uid, 'chats', chatId, 'mensagens'), {
        ...userMessage,
        createdAt: serverTimestamp()
      });
    }

    setInput('');
    setLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMessage], model }),
        signal: abortControllerRef.current.signal,
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
        await addDoc(collection(db, 'conversas', user.uid, 'chats', chatId, 'mensagens'), {
          role: 'assistant',
          content: assistantMessage,
          createdAt: serverTimestamp()
        });
      }

    } catch (error) {
      if (error.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: `❌ Erro: ${error.message}` }]);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="app">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}></div>}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} style={{ display: 'flex', transform: 'translateX(0)' }}>
        <button onClick={createNewChat} className="new-chat-btn">+ Nova Conversa</button>
        <div className="chat-list">
          {chats.map(chat => (
            <div 
              key={chat.id} 
              className={`chat-item ${currentChatId === chat.id ? 'active' : ''}`}
              onClick={() => { setCurrentChatId(chat.id); setSidebarOpen(false); }}
            >
              <span className="chat-title">{chat.title || 'Sem título'}</span>
              <button className="delete-chat-btn" onClick={(e) => deleteChat(e, chat.id)} title="Apagar">
                🗑️
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="main-chat">
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
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
                <button onClick={handleLogout} className="btn-theme">Sair</button>
              </div>
            ) : (
              <button onClick={handleLogin} className="btn-theme">🔑 Entrar com Google</button>
            )}
          </div>
        </header>

        <main className="chat-window">
          {messages.map((msg, i) => (
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
            placeholder="Diz aí..."
            rows={1}
          />
          {loading ? (
            <button onClick={stopGeneration} className="stop-btn">⏹</button>
          ) : (
            <button onClick={sendMessage} disabled={!input.trim()}>➤</button>
          )}
        </footer>
      </div>
    </div>
  );
}