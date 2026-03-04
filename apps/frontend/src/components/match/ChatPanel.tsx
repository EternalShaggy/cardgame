import { useRef, useEffect, useState } from 'react';

interface ChatMessage {
  userId: string;
  displayName: string;
  text: string;
  ts: number;
}

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  myUserId: string;
}

export default function ChatPanel({ messages, onSend, myUserId }: Props) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {messages.map((msg, i) => (
          <div key={i} className={`text-sm ${msg.userId === myUserId ? 'text-right' : ''}`}>
            <span className="text-indigo-400 font-semibold text-xs">{msg.displayName}: </span>
            <span className="text-gray-300">{msg.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 p-2 border-t border-gray-700">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Chat…"
          maxLength={200}
          className="flex-1 bg-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button type="submit" className="btn-primary text-sm px-3">→</button>
      </form>
    </div>
  );
}
