import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, Check, ChevronRight, ChevronLeft, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface AgentInstallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sites: { id: string; name: string }[];
}

interface InstallData {
  command: string;
  silentCommand?: string;
  downloadUrl: string;
  bootstrapUrl?: string;
  extension: string;
}

const osOptions = [
  { value: 'WINDOWS', label: 'Windows', ext: '.msi' },
  { value: 'MACOS', label: 'macOS', ext: '.pkg' },
  { value: 'LINUX', label: 'Linux', ext: '.sh' },
];

export function AgentInstallModal({ open, onOpenChange, sites }: AgentInstallModalProps) {
  const [step, setStep] = useState(1);
  const [osType, setOsType] = useState('WINDOWS');
  const [siteId, setSiteId] = useState('');
  const [folder, setFolder] = useState('');
  const [installData, setInstallData] = useState<InstallData | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const generateInstall = useMutation({
    mutationFn: () =>
      api.post<{ success: boolean; data: InstallData }>(
        '/api/devices/agent/install',
        {
          osType,
          siteId: siteId && siteId !== 'none' ? siteId : undefined,
          folder: folder || undefined,
        }
      ),
    onSuccess: (res) => {
      setInstallData(res.data);
      setStep(3);
    },
    onError: (err) => toast({ title: 'Erro', description: (err as Error).message, variant: 'destructive' }),
  });

  const handleClose = () => {
    onOpenChange(false);
    setStep(1);
    setInstallData(null);
  };

  const copyCommand = () => {
    if (!installData) return;
    navigator.clipboard.writeText(installData.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = async (url: string, label: string) => {
    try {
      // Em production a API rejeita ?token=; Bearer com o agentToken da URL funciona.
      const parsed = new URL(url, window.location.origin);
      const agentToken = parsed.searchParams.get('token');
      const headers: HeadersInit = {};
      if (agentToken) {
        headers.Authorization = `Bearer ${agentToken}`;
        parsed.searchParams.delete('token');
      }

      const res = await fetch(parsed.toString(), { headers });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = label.includes('.bat') ? 'NexaOpsAgent-install.bat' : 'NexaOpsAgent.msi';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast({ title: 'Download iniciado', description: label });
    } catch (err) {
      toast({
        title: 'Falha no download',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Instalar Agente NexaOps</DialogTitle>
        </DialogHeader>

        <div className="mb-6 flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  step >= s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {s}
              </div>
              <span className="text-xs text-muted-foreground">
                {s === 1 ? 'Selecionar SO' : s === 2 ? 'Atribuir agente' : 'Instalar'}
              </span>
              {s < 3 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Selecione o sistema operacional do dispositivo:</p>
            <div className="grid grid-cols-3 gap-3">
              {osOptions.map((os) => (
                <button
                  key={os.value}
                  onClick={() => setOsType(os.value)}
                  className={`rounded-lg border p-4 text-center transition-colors hover:border-primary ${
                    osType === os.value ? 'border-primary bg-primary/10' : ''
                  }`}
                >
                  <p className="font-medium">{os.label}</p>
                  <p className="text-xs text-muted-foreground">{os.ext}</p>
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)}>Próximo</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Site / Cliente</label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar site (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Pasta / Grupo</label>
              <Input
                placeholder="Ex: Financeiro, Servidores..."
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              />
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button onClick={() => generateInstall.mutate()} disabled={generateInstall.isPending}>
                Gerar instalador
              </Button>
            </div>
          </div>
        )}

        {step === 3 && installData && (
          <div className="space-y-4">
            {osType === 'WINDOWS' && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => downloadFile(installData.downloadUrl, 'NexaOpsAgent.msi')}
                >
                  <Download className="h-4 w-4" />
                  Baixar MSI
                </Button>
                {installData.bootstrapUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => downloadFile(installData.bootstrapUrl!, 'Instalador automático (.bat)')}
                  >
                    <Download className="h-4 w-4" />
                    Instalador .bat
                  </Button>
                )}
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              Execute como administrador no equipamento Windows:
            </p>
            <div className="relative rounded-md bg-muted p-4">
              <pre className="overflow-x-auto text-xs whitespace-pre-wrap break-all">{installData.command}</pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2"
                onClick={copyCommand}
              >
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            {installData.silentCommand && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Instalação silenciosa (GPO/PDQ)</p>
                <code className="block break-all text-xs">{installData.silentCommand}</code>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              O MSI instala um serviço Windows que monitora CPU, RAM, disco e interfaces de rede automaticamente.
            </p>
            <div className="flex justify-end">
              <Button onClick={handleClose}>Concluir</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
