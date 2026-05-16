import React, { useMemo, useRef, useState } from 'react';
import { Bot, Database, Gauge, Loader2, Send, Sparkles, Trash2, X } from 'lucide-react';
import { getApiKey } from '../../runtimeConfig';

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

type Props = {
  activeBusinessId: string | null;
  activeBranchId: string | null;
  currentUser: any;
};

const quickPrompts = [
  'Which stock has not moved for 2 months?',
  'What should I avoid buying this week?',
  'Which customers owe us the most?',
  'Show me pending approvals and cash risks.',
];

export default function AIAssistant({ activeBusinessId, activeBranchId, currentUser }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Ask me about stock movement, slow products, customer balances, supplier debt, expenses, approvals, or sales trends.',
    },
  ]);
  const [usage, setUsage] = useState<{ used: number; limit: number; remaining: number; day: string } | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const disabledReason = useMemo(() => {
    if (!activeBusinessId) return 'Log in to a business first.';
    if (!activeBranchId) return 'Select a branch first.';
    if (!currentUser) return 'Log in first.';
    return '';
  }, [activeBusinessId, activeBranchId, currentUser]);

  if (currentUser?.role !== 'ADMIN') return null;

  const addMessage = (role: Message['role'], text: string) => {
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role, text }]);
  };

  const ask = async (promptOverride?: string) => {
    const prompt = (promptOverride ?? question).trim();
    if (!prompt || disabledReason || isAsking) return;

    setQuestion('');
    addMessage('user', prompt);
    setIsAsking(true);

    try {
      const apiKey = await getApiKey();
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-Business-ID': activeBusinessId!,
          'X-Branch-ID': activeBranchId!,
          'X-User-ID': currentUser?.id || 'unknown',
          'X-User-Name': currentUser?.name || 'Unknown user',
        },
        body: JSON.stringify({ question: prompt }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `AI request failed (${res.status})`);
      if (data?.usage) setUsage(data.usage);
      addMessage('assistant', data?.answer || 'I could not produce an answer from the available POS data.');
    } catch (err: any) {
      addMessage('assistant', err?.message || 'AI request failed.');
    } finally {
      setIsAsking(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed left-4 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl shadow-blue-500/30 transition-transform active:scale-95 md:left-auto md:right-6 md:bottom-6"
        aria-label="Open AI assistant"
        title="AI assistant"
      >
        <Bot size={25} />
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-emerald-500 px-1 text-[9px] font-black">
          AI
        </span>
      </button>

      {isOpen && (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 flex max-h-[74dvh] flex-col overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-2xl md:inset-auto md:bottom-24 md:right-6 md:h-[620px] md:w-[430px]">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-blue-600 px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <Sparkles size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-black">Mtaani AI</h3>
                <p className="truncate text-[10px] font-bold uppercase tracking-widest text-blue-100">
                  D1 business analyst
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 transition-colors hover:bg-white/20"
              aria-label="Close AI assistant"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
            <div className="flex min-w-0 items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <Database size={14} className="shrink-0 text-blue-600" />
              <span className="truncate">Live POS data</span>
            </div>
            {usage && (
              <div className="flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 shadow-sm">
                <Gauge size={12} className="text-emerald-600" />
                {usage.remaining}/{usage.limit} left
              </div>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
            {messages.map(message => (
              <div
                key={message.id}
                className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                  message.role === 'user'
                    ? 'ml-auto bg-blue-600 text-white'
                    : 'mr-auto border border-slate-100 bg-white text-slate-700'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.text}</p>
              </div>
            ))}
            {isAsking && (
              <div className="mr-auto flex max-w-[92%] items-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm font-bold text-slate-500 shadow-sm">
                <Loader2 size={16} className="animate-spin text-blue-600" />
                Reading your POS data...
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 bg-white p-3">
            <div className="mb-3 flex gap-2 overflow-x-auto no-scrollbar">
              {quickPrompts.map(prompt => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => ask(prompt)}
                  disabled={isAsking || !!disabledReason}
                  className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500 disabled:opacity-40"
                >
                  {prompt}
                </button>
              ))}
            </div>

            {disabledReason && (
              <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
                {disabledReason}
              </div>
            )}

            <form
              className="grid grid-cols-[1fr_auto_auto] items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask();
              }}
            >
              <textarea
                ref={inputRef}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                rows={2}
                placeholder="Ask about stock, sales, credit, expenses..."
                className="max-h-28 min-h-[3rem] resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-400 focus:bg-white"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    ask();
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setMessages(messages.slice(0, 1))}
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 transition-colors hover:text-rose-500"
                aria-label="Clear AI chat"
                title="Clear chat"
              >
                <Trash2 size={18} />
              </button>
              <button
                type="submit"
                disabled={!question.trim() || isAsking || !!disabledReason}
                className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/20 transition-transform active:scale-95 disabled:opacity-40"
                aria-label="Send AI question"
                title="Send"
              >
                {isAsking ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
