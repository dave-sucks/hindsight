'use client';

import { useState, useRef, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import ThesisCard from '@/components/ThesisCard';
import { mockResearchRuns, getMockThesisForTicker, type MockThesis } from '@/lib/mock-data/research';
import { Send, FlaskConical, Bot, User } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'ai';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content?: string;
  thesis?: MockThesis;
  timestamp: Date;
}

// ─── TypingIndicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-1">
      <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="flex gap-1 items-center bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
            style={{ animationDelay: `${i * 150}ms`, animationDuration: '900ms' }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── ChatMessage ──────────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[75%] bg-secondary text-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
          {message.content}
        </div>
        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-1">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="flex-1 max-w-[90%]">
        {message.thesis ? (
          <ThesisCard thesis={message.thesis} />
        ) : (
          <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-foreground">
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function ChatEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16 px-6">
      <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Bot className="h-7 w-7 text-primary" />
      </div>
      <div>
        <p className="text-lg font-medium text-foreground">Ask Hindsight to research any stock</p>
        <p className="text-sm text-muted-foreground mt-1">
          Try: <span className="text-primary font-mono">Research NVDA for a swing trade</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center mt-2">
        {['NVDA swing long', 'TSLA short thesis', 'META earnings play'].map((suggestion) => (
          <Badge key={suggestion} variant="outline" className="cursor-pointer hover:bg-secondary transition-colors text-xs">
            {suggestion}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function FeedEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <FlaskConical className="h-12 w-12 text-muted-foreground/40" />
      <div>
        <p className="text-lg font-medium text-foreground">No automated research runs yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Scheduled agent runs will start at M5. Use the Chat tab to trigger manual research.
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ResearchPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ticker, setTicker] = useState('');
  const [direction, setDirection] = useState<'LONG' | 'SHORT' | 'AUTO'>('AUTO');
  const [holdDuration, setHoldDuration] = useState('SWING');
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSend = async () => {
    const rawTicker = ticker.trim().replace(/^\$/, '').toUpperCase();
    if (!rawTicker || isTyping) return;

    const userMsg = `Research ${rawTicker}${direction !== 'AUTO' ? ` — ${direction}` : ''} (${holdDuration.toLowerCase()})`;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: userMsg,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setTicker('');
    setIsTyping(true);

    // Mock 2s delay
    await new Promise((r) => setTimeout(r, 2000));

    const thesis = getMockThesisForTicker(rawTicker);
    const aiMessage: ChatMessage = {
      id: `msg-${Date.now()}-ai`,
      role: 'ai',
      thesis,
      timestamp: new Date(),
    };

    setIsTyping(false);
    setMessages((prev) => [...prev, aiMessage]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] md:h-screen p-6 gap-4">
      <h1 className="text-2xl font-semibold text-foreground shrink-0">Research</h1>

      <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
        <TabsList className="shrink-0 w-fit">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="feed">
            Research Feed
            <Badge variant="secondary" className="ml-1.5 text-xs tabular-nums">
              {mockResearchRuns.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── Chat Tab ── */}
        <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-4">
          {/* Thread */}
          <div className="flex-1 min-h-0 relative">
            <ScrollArea className="h-full pr-2">
              {messages.length === 0 && !isTyping ? (
                <ChatEmptyState />
              ) : (
                <div className="space-y-4 py-2">
                  {messages.map((msg) => (
                    <ChatBubble key={msg.id} message={msg} />
                  ))}
                  {isTyping && <TypingIndicator />}
                  <div ref={bottomRef} />
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Composer — pinned to bottom */}
          <div className="shrink-0 pt-4">
            <div className="flex gap-2 items-center bg-card border border-border rounded-xl p-3">
              {/* Ticker input */}
              <Input
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="$TICKER"
                className="w-28 font-mono text-sm bg-transparent border-0 focus-visible:ring-0 px-2 h-8 uppercase placeholder:normal-case placeholder:text-muted-foreground"
                disabled={isTyping}
              />

              <div className="h-5 w-px bg-border" />

              {/* Direction */}
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v as typeof direction)}
                disabled={isTyping}
              >
                <SelectTrigger className="w-24 h-8 text-xs border-0 bg-transparent focus:ring-0 shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Auto</SelectItem>
                  <SelectItem value="LONG">Long</SelectItem>
                  <SelectItem value="SHORT">Short</SelectItem>
                </SelectContent>
              </Select>

              {/* Hold duration */}
              <Select
                value={holdDuration}
                onValueChange={setHoldDuration}
                disabled={isTyping}
              >
                <SelectTrigger className="w-28 h-8 text-xs border-0 bg-transparent focus:ring-0 shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SWING">Swing</SelectItem>
                  <SelectItem value="POSITION">Position</SelectItem>
                  <SelectItem value="INTRADAY">Intraday</SelectItem>
                </SelectContent>
              </Select>

              <div className="ml-auto">
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={!ticker.trim() || isTyping}
                  className="h-8 w-8 p-0"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span className="sr-only">Send</span>
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground/60 text-center mt-2">
              Press Enter or click Send to trigger AI research
            </p>
          </div>
        </TabsContent>

        {/* ── Research Feed Tab ── */}
        <TabsContent value="feed" className="flex-1 min-h-0 mt-4">
          <ScrollArea className="h-full">
            {mockResearchRuns.length === 0 ? (
              <FeedEmptyState />
            ) : (
              <div className="space-y-4 pb-4">
                {[...mockResearchRuns].reverse().map((thesis) => (
                  <div key={thesis.id}>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs',
                          thesis.triggeredBy === 'AGENT'
                            ? 'border-primary/40 text-primary'
                            : 'border-border text-muted-foreground'
                        )}
                      >
                        {thesis.triggeredBy === 'AGENT' ? '🤖 Agent' : '👤 Manual'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(thesis.researchedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <ThesisCard thesis={thesis} />
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
