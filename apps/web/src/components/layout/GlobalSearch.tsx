import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Monitor, Ticket, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const quickLinks = [
  { label: 'Dispositivos', path: '/devices', icon: Monitor, keywords: ['device', 'dispositivo', 'pc', 'servidor'] },
  { label: 'Tickets', path: '/tickets', icon: Ticket, keywords: ['ticket', 'chamado', 'help'] },
  { label: 'Sites', path: '/sites', icon: Building2, keywords: ['site', 'cliente', 'crm'] },
];

export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const results = query.trim()
    ? quickLinks.filter(
        (l) =>
          l.label.toLowerCase().includes(query.toLowerCase()) ||
          l.keywords.some((k) => k.includes(query.toLowerCase()))
      )
    : quickLinks;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="Buscar módulos..."
        className="bg-muted/40 pl-9 focus:bg-background"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-card shadow-lg">
          {results.map((r) => (
            <button
              key={r.path}
              onClick={() => { navigate(r.path); setOpen(false); setQuery(''); }}
              className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50')}
            >
              <r.icon className="h-4 w-4 text-muted-foreground" />
              {r.label}
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum resultado</p>
          )}
        </div>
      )}
    </div>
  );
}
