import * as React from 'react';
import { ToastProvider, ToastViewport } from '@/components/ui/toast';

type ToastMessage = { title: string; description?: string; variant?: 'default' | 'destructive' };

const ToastContext = React.createContext<{
  toast: (msg: ToastMessage) => void;
}>({ toast: () => {} });

export function ToastContextProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<(ToastMessage & { id: number })[]>([]);

  const toast = React.useCallback((msg: ToastMessage) => {
    const id = Date.now();
    setMessages((prev) => [...prev, { ...msg, id }]);
    setTimeout(() => setMessages((prev) => prev.filter((m) => m.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastProvider>
        {children}
        {messages.map((m) => (
          <div key={m.id} className={`fixed bottom-4 right-4 z-[100] rounded-md border p-4 shadow-lg animate-in slide-in-from-bottom-2 ${m.variant === 'destructive' ? 'bg-destructive text-destructive-foreground' : 'bg-card'}`}>
            <p className="text-sm font-semibold">{m.title}</p>
            {m.description && <p className="text-sm opacity-80">{m.description}</p>}
          </div>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastContext);
}
