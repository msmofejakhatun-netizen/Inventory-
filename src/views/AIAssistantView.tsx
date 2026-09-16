import React, { useEffect, useState, useRef } from 'react';
import {
  Sparkles,
  Send,
  Bot,
  User,
  HelpCircle,
  TrendingUp,
  AlertTriangle,
  Lock,
  Boxes,
  RotateCcw,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Item, Vendor, Purchase, Issue, EmergencyIssue, Wastage } from '../types';
import { calculateStoreHealthScore, calculateExcessStock, calculateAverageDailyConsumption } from '../services/calculations';
import { Badge } from '../components/common/Badge';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export const AIAssistantView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, userProfile, user } = useAuth();

  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [emergencyIssues, setEmergencyIssues] = useState<EmergencyIssue[]>([]);
  const [wastages, setWastages] = useState<Wastage[]>([]);

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Hello ${userProfile?.name || 'Boss'}! I am your AI Store Analyst. I am connected directly to your live Firebase inventory ledger. Ask me anything about your stock values, blocked cash, vendor dues, price hikes, or 15-day purchase planning.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currencySymbol = activeRestaurant?.currencySymbol || '₹';

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubItems = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'items'), (s) =>
      setItems(s.docs.map((d) => d.data() as Item))
    );
    const unsubVendors = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'vendors'), (s) =>
      setVendors(s.docs.map((d) => d.data() as Vendor))
    );
    const unsubPurchases = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'purchases'), (s) =>
      setPurchases(s.docs.map((d) => d.data() as Purchase))
    );
    const unsubIssues = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'issues'), (s) =>
      setIssues(s.docs.map((d) => d.data() as Issue))
    );
    const unsubEmerg = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'emergencyIssues'), (s) =>
      setEmergencyIssues(s.docs.map((d) => d.data() as EmergencyIssue))
    );
    const unsubWastage = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'wastage'), (s) =>
      setWastages(s.docs.map((d) => d.data() as Wastage))
    );

    return () => {
      unsubItems();
      unsubVendors();
      unsubPurchases();
      unsubIssues();
      unsubEmerg();
      unsubWastage();
    };
  }, [activeRestaurantId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Compute live state for AI context
  const totalStockValue = items.reduce(
    (sum, i) => sum + i.currentStock * (i.averageStockRate || i.lastPurchaseRate || 0),
    0
  );

  let totalCashBlocked = 0;
  const excessItems: any[] = [];
  items.forEach((item) => {
    const { avgDailyQty } = calculateAverageDailyConsumption(issues, item.id, 14);
    const { isExcess, excessQty, excessValue } = calculateExcessStock(item, avgDailyQty);
    if (isExcess && excessValue > 0) {
      totalCashBlocked += excessValue;
      excessItems.push({ name: item.name, excessQty, excessValue, unit: item.unit });
    }
  });

  const totalVendorDue = vendors.reduce((sum, v) => sum + (Number(v.currentDue) || 0), 0);

  const healthScore = calculateStoreHealthScore({
    totalStockValue,
    totalCashBlocked,
    itemsWithLowStockCount: items.filter((i) => i.minimumStock > 0 && i.currentStock <= i.minimumStock).length,
    totalItemsCount: items.length,
    totalVendorDue,
    totalPurchases30Days: purchases.reduce((sum, p) => sum + (Number(p.netAmount) || 0), 0),
    totalWastageValue30Days: wastages.reduce((sum, w) => sum + (Number(w.value) || 0), 0),
    totalIssuesValue30Days: issues.reduce((sum, i) => sum + (Number(i.value) || 0), 0),
    emergencyIssuesCount7Days: emergencyIssues.length,
    varianceIncidentsCount30Days: 0,
    priceHikesCount30Days: 0,
  });

  const handleSendMessage = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim() || loading) return;

    const userMsg: Message = {
      role: 'user',
      content: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!queryText) setInputQuery('');
    setLoading(true);

    try {
      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: textToSend.trim(),
          context: {
            restaurantName: activeRestaurant?.name,
            totalStockValue,
            totalCashBlocked,
            totalVendorDue,
            healthScore: healthScore.score,
            itemsCount: items.length,
            vendorsCount: vendors.length,
            purchasesCount: purchases.length,
            issuesCount: issues.length,
            emergencyIssuesCount: emergencyIssues.length,
            wastagesCount: wastages.length,
            excessItems: excessItems.slice(0, 10),
            topVendorsWithDues: vendors
              .filter((v) => v.currentDue > 0)
              .map((v) => ({ name: v.name, due: v.currentDue }))
              .slice(0, 5),
          },
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server responded with status ${response.status}`);
      }

      const data = await response.json();
      const assistantMsg: Message = {
        role: 'assistant',
        content: data.answer || data.reply || "I couldn't analyze the query. Please try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: err.message ? `AI Service Error: ${err.message}` : 'Sorry, I encountered an error connecting to the AI assistant backend.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const quickPrompts = [
    'Why is cash blocked in stock high?',
    'Which vendors have highest outstanding dues?',
    'Break down my Store Health Score',
    'Which items have the highest consumption rate?',
    'How should I reduce kitchen wastage?',
  ];

  return (
    <div className="h-[calc(100vh-8.5rem)] flex flex-col bg-white rounded-xl border border-stone-200 overflow-hidden shadow-2xs">
      {/* Header */}
      <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-amber-600 text-white shadow-2xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-stone-900">
                AI Store Analyst
              </h2>
              <Badge variant="success" size="sm">
                Grounded in Real DB
              </Badge>
            </div>
            <p className="text-[11px] text-stone-500">
              Live intelligence powered by Gemini • Never guesses or uses fake records
            </p>
          </div>
        </div>

        <button
          onClick={() =>
            setMessages([
              {
                role: 'assistant',
                content: `Chat history cleared. How can I help audit your store finances today?`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              },
            ])
          }
          className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg"
          title="Reset Conversation"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex items-start gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {m.role === 'assistant' && (
              <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-900 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div
              className={`max-w-2xl rounded-xl p-3.5 text-xs leading-relaxed shadow-2xs ${
                m.role === 'user'
                  ? 'bg-amber-600 text-white font-medium'
                  : 'bg-stone-50 text-stone-800 border border-stone-200 font-sans whitespace-pre-line'
              }`}
            >
              {m.content}
              <div
                className={`text-[9px] mt-1.5 ${
                  m.role === 'user' ? 'text-amber-200 text-right' : 'text-stone-400'
                }`}
              >
                {m.timestamp}
              </div>
            </div>

            {m.role === 'user' && (
              <div className="w-7 h-7 rounded-lg bg-stone-900 text-white flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-stone-400 pl-10">
            <Sparkles className="w-3.5 h-3.5 animate-spin text-amber-600" />
            Analyzing real store ledger & calculating metrics...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="p-3 bg-stone-50/70 border-t border-stone-100 flex items-center gap-1.5 overflow-x-auto">
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 whitespace-nowrap mr-1">
          Suggestions:
        </span>
        {quickPrompts.map((prompt, i) => (
          <button
            key={i}
            onClick={() => handleSendMessage(prompt)}
            disabled={loading}
            className="px-2.5 py-1 rounded-lg border border-stone-200 bg-white hover:bg-stone-100 text-[11px] text-stone-700 whitespace-nowrap font-medium transition-colors disabled:opacity-50"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input Box */}
      <div className="p-3 bg-white border-t border-stone-200">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            id="ai-assistant-input"
            type="text"
            placeholder="Ask about store cash, vendors, excess inventory, or stock planning..."
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            disabled={loading}
            className="flex-1 px-3.5 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500 disabled:opacity-60"
          />
          <button
            id="send-ai-query-btn"
            type="submit"
            disabled={loading || !inputQuery.trim()}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
};
