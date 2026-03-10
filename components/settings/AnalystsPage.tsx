'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createAnalyst,
  updateAnalyst,
  toggleAnalystEnabled,
  deleteAnalyst,
  type AnalystFormInput,
} from '@/lib/actions/settings.actions';
import type { AgentConfig } from '@/lib/generated/prisma';

// ─── Constants ────────────────────────────────────────────────────────────────

const SIGNAL_TYPES = [
  { id: 'EARNINGS_BEAT', label: 'Earnings Beat' },
  { id: 'EARNINGS_CATALYST', label: 'Earnings Catalyst' },
  { id: 'TECHNICAL_BREAKOUT', label: 'Technical Breakout' },
  { id: 'NEWS_CATALYST', label: 'News Catalyst' },
  { id: 'MOMENTUM', label: 'Momentum' },
];

const HOLD_DURATIONS = [
  { id: 'DAY', label: 'Day Trade' },
  { id: 'SWING', label: 'Swing' },
  { id: 'LONG', label: 'Long-term' },
];

const SECTORS = [
  { id: 'Technology', label: 'Technology' },
  { id: 'Healthcare', label: 'Healthcare' },
  { id: 'Financials', label: 'Financials' },
  { id: 'Energy', label: 'Energy' },
  { id: 'Consumer Discretionary', label: 'Consumer Discr.' },
  { id: 'Industrials', label: 'Industrials' },
  { id: 'Materials', label: 'Materials' },
  { id: 'Communication Services', label: 'Communication' },
  { id: 'Real Estate', label: 'Real Estate' },
  { id: 'Utilities', label: 'Utilities' },
];

const DEFAULT_FORM: AnalystFormInput = {
  name: '',
  enabled: true,
  minConfidence: 70,
  maxOpenPositions: 3,
  holdDurations: ['SWING'],
  sectors: ['Technology', 'Healthcare', 'Financials'],
  signalTypes: ['EARNINGS_BEAT', 'TECHNICAL_BREAKOUT'],
  directionBias: 'BOTH',
  description: null,
  strategyType: 'DISCOVERY',
  strategyInstructions: null,
  tradePolicyAutoTrade: true,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signalLabel(id: string): string {
  return SIGNAL_TYPES.find((s) => s.id === id)?.label ?? id;
}

function durationLabel(id: string): string {
  return HOLD_DURATIONS.find((d) => d.id === id)?.label ?? id;
}

function toggleItem(id: string, current: string[]): string[] {
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}

// ─── Analyst Form Sheet ───────────────────────────────────────────────────────

function AnalystFormSheet({
  open,
  onOpenChange,
  editing,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: AgentConfig | null;
  onSuccess: (config: AgentConfig, isNew: boolean) => void;
}) {
  const [form, setForm] = useState<AnalystFormInput>(() =>
    editing
      ? {
          name: editing.name,
          enabled: editing.enabled,
          minConfidence: editing.minConfidence,
          maxOpenPositions: editing.maxOpenPositions,
          holdDurations: editing.holdDurations,
          sectors: editing.sectors,
          signalTypes: editing.signalTypes,
          directionBias: editing.directionBias,
          description: (editing as { description?: string | null }).description ?? null,
          strategyType: (editing as { strategyType?: string }).strategyType ?? 'DISCOVERY',
          strategyInstructions: (editing as { strategyInstructions?: string | null }).strategyInstructions ?? null,
          tradePolicyAutoTrade: (editing as { tradePolicyAutoTrade?: boolean }).tradePolicyAutoTrade ?? true,
        }
      : { ...DEFAULT_FORM }
  );

  const [isPending, startTransition] = useTransition();

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast.error('Analyst name is required');
      return;
    }
    if (form.signalTypes.length === 0) {
      toast.error('Select at least one signal type');
      return;
    }
    if (form.holdDurations.length === 0) {
      toast.error('Select at least one hold duration');
      return;
    }

    startTransition(async () => {
      if (editing) {
        const result = await updateAnalyst(editing.id, form);
        if (result.success) {
          toast.success('Analyst updated');
          onSuccess({ ...editing, ...form }, false);
          onOpenChange(false);
        } else {
          toast.error(result.error ?? 'Failed to update analyst');
        }
      } else {
        const result = await createAnalyst(form);
        if (result.success && result.id) {
          toast.success('Analyst created');
          const newConfig: AgentConfig = {
            id: result.id,
            userId: '',
            name: form.name,
            enabled: form.enabled,
            minConfidence: form.minConfidence,
            maxOpenPositions: form.maxOpenPositions,
            holdDurations: form.holdDurations,
            sectors: form.sectors,
            signalTypes: form.signalTypes,
            directionBias: form.directionBias,
            description: form.description ?? null,
            strategyType: form.strategyType ?? 'DISCOVERY',
            strategyInstructions: form.strategyInstructions ?? null,
            tradePolicyAutoTrade: form.tradePolicyAutoTrade ?? true,
            markets: ['NASDAQ', 'NYSE'],
            exchanges: ['NASDAQ', 'NYSE'],
            watchlist: [],
            exclusionList: [],
            maxPositionSize: 1000,
            maxRiskPct: 2,
            dailyLossLimit: 300,
            minMarketCapTier: 'LARGE',
            scheduleTime: '08:00',
            priceCheckFreq: 'HOURLY',
            weekendMode: false,
            graduationWinRate: 0.65,
            graduationMinTrades: 50,
            graduationProfitFactor: 1.5,
            realTradingEnabled: false,
            realMaxPosition: 500,
            emailAlerts: true,
            weeklyDigestEnabled: true,
            digestEmail: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          onSuccess(newConfig, true);
          onOpenChange(false);
        } else {
          toast.error(result.error ?? 'Failed to create analyst');
        }
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col overflow-hidden sm:max-w-[480px]">
        <SheetHeader className="shrink-0">
          <SheetTitle>{editing ? 'Edit Analyst' : 'New Analyst'}</SheetTitle>
        </SheetHeader>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Analyst Name
            </Label>
            <Input
              placeholder="e.g. Momentum Trader"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="h-9"
            />
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Analyst will run daily research</p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
          </div>

          <Separator />

          {/* Min Confidence + Max Positions */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Min Confidence
              </Label>
              <Select
                value={String(form.minConfidence)}
                onValueChange={(v) => setForm((f) => ({ ...f, minConfidence: Number(v) }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[60, 65, 70, 75, 80].map((v) => (
                    <SelectItem key={v} value={String(v)}>
                      {v}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Max Positions
              </Label>
              <Select
                value={String(form.maxOpenPositions)}
                onValueChange={(v) => setForm((f) => ({ ...f, maxOpenPositions: Number(v) }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 5, 10].map((v) => (
                    <SelectItem key={v} value={String(v)}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Direction Bias */}
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Direction Bias
            </Label>
            <RadioGroup
              value={form.directionBias}
              onValueChange={(v) => setForm((f) => ({ ...f, directionBias: v }))}
              className="flex gap-4"
            >
              {['LONG', 'SHORT', 'BOTH'].map((b) => (
                <div key={b} className="flex items-center gap-1.5">
                  <RadioGroupItem value={b} id={`bias-${b}`} />
                  <Label htmlFor={`bias-${b}`} className="text-sm cursor-pointer">
                    {b.charAt(0) + b.slice(1).toLowerCase()}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <Separator />

          {/* Hold Durations */}
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Hold Durations
            </Label>
            <div className="flex flex-wrap gap-3">
              {HOLD_DURATIONS.map(({ id, label }) => (
                <div key={id} className="flex items-center gap-2">
                  <Checkbox
                    id={`dur-${id}`}
                    checked={form.holdDurations.includes(id)}
                    onCheckedChange={() =>
                      setForm((f) => ({ ...f, holdDurations: toggleItem(id, f.holdDurations) }))
                    }
                  />
                  <Label htmlFor={`dur-${id}`} className="text-sm cursor-pointer">
                    {label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Signal Types */}
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Signal Types
            </Label>
            <div className="space-y-2">
              {SIGNAL_TYPES.map(({ id, label }) => (
                <div key={id} className="flex items-center gap-2">
                  <Checkbox
                    id={`sig-${id}`}
                    checked={form.signalTypes.includes(id)}
                    onCheckedChange={() =>
                      setForm((f) => ({ ...f, signalTypes: toggleItem(id, f.signalTypes) }))
                    }
                  />
                  <Label htmlFor={`sig-${id}`} className="text-sm cursor-pointer">
                    {label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Strategy Type + Auto-Trade */}
          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Strategy Type
              </Label>
              <Select
                value={form.strategyType ?? 'DISCOVERY'}
                onValueChange={(v) => setForm((f) => ({ ...f, strategyType: v }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DISCOVERY">Discovery</SelectItem>
                  <SelectItem value="WATCHLIST">Watchlist</SelectItem>
                  <SelectItem value="DIRECTED">Directed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between pt-6">
              <div>
                <p className="text-sm font-medium">Auto-Trade</p>
                <p className="text-xs text-muted-foreground">Place trades automatically</p>
              </div>
              <Switch
                checked={form.tradePolicyAutoTrade ?? true}
                onCheckedChange={(v) => setForm((f) => ({ ...f, tradePolicyAutoTrade: v }))}
              />
            </div>
          </div>

          {/* Strategy Instructions */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Strategy Instructions{' '}
              <span className="normal-case font-normal text-muted-foreground/60">(optional)</span>
            </Label>
            <Textarea
              placeholder="e.g. Focus on EV stocks with upcoming earnings. Prefer day trades with clear catalysts."
              value={form.strategyInstructions ?? ''}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  strategyInstructions: e.target.value || null,
                }))
              }
              rows={3}
              className="resize-none text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Injected into the AI analysis prompt. Guides sector focus, trade style, and thesis generation.
            </p>
          </div>

          <Separator />

          {/* Sectors */}
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sectors
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {SECTORS.map(({ id, label }) => (
                <div key={id} className="flex items-center gap-2">
                  <Checkbox
                    id={`sec-${id}`}
                    checked={form.sectors.includes(id)}
                    onCheckedChange={() =>
                      setForm((f) => ({ ...f, sectors: toggleItem(id, f.sectors) }))
                    }
                  />
                  <Label htmlFor={`sec-${id}`} className="text-sm cursor-pointer">
                    {label}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <SheetFooter className="shrink-0 flex-row gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending} className="flex-1">
            {isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Analyst'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Analyst Card ─────────────────────────────────────────────────────────────

function AnalystCard({
  config,
  onEdit,
  onDelete,
  onToggle,
}: {
  config: AgentConfig;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = (checked: boolean) => {
    startTransition(async () => {
      const result = await toggleAnalystEnabled(config.id, checked);
      if (result.success) {
        onToggle(checked);
        toast.success(checked ? `${config.name} enabled` : `${config.name} paused`);
      } else {
        toast.error('Failed to update analyst');
      }
    });
  };

  return (
    <Card className="border-border">
      <CardHeader className="p-6 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-foreground truncate">{config.name}</h3>
              <Badge
                variant={config.enabled ? 'default' : 'secondary'}
                className="text-xs shrink-0"
              >
                {config.enabled ? 'Active' : 'Paused'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {config.minConfidence}% min confidence &middot;{' '}
              {config.maxOpenPositions} max positions &middot;{' '}
              {config.directionBias.charAt(0) + config.directionBias.slice(1).toLowerCase()}
            </p>
          </div>
          <Switch
            checked={config.enabled}
            onCheckedChange={handleToggle}
            disabled={isPending}
            className="shrink-0 mt-0.5"
          />
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6 pt-0">
        {/* Signal type chips */}
        {config.signalTypes.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
              Signals
            </p>
            <div className="flex flex-wrap gap-1.5">
              {config.signalTypes.map((s: string) => (
                <Badge key={s} variant="outline" className="text-xs font-normal">
                  {signalLabel(s)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Hold duration chips */}
        {config.holdDurations.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
              Hold Durations
            </p>
            <div className="flex flex-wrap gap-1.5">
              {config.holdDurations.map((d: string) => (
                <Badge key={d} variant="secondary" className="text-xs font-normal">
                  {durationLabel(d)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-3 border-t border-border">
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AnalystsPage({
  initialConfigs,
}: {
  initialConfigs: AgentConfig[];
}) {
  const [configs, setConfigs] = useState<AgentConfig[]>(initialConfigs);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetKey, setSheetKey] = useState(0);
  const [editingConfig, setEditingConfig] = useState<AgentConfig | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentConfig | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  const openCreate = () => {
    setEditingConfig(null);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  };

  const openEdit = (config: AgentConfig) => {
    setEditingConfig(config);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  };

  const handleSheetSuccess = (updated: AgentConfig, isNew: boolean) => {
    if (isNew) {
      setConfigs((prev) => [...prev, updated]);
    } else {
      setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    }
  };

  const handleToggle = (id: string, enabled: boolean) => {
    setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, enabled } : c)));
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    startDeleteTransition(async () => {
      const result = await deleteAnalyst(deleteTarget.id);
      if (result.success) {
        toast.success(`${deleteTarget.name} deleted`);
        setConfigs((prev) => prev.filter((c) => c.id !== deleteTarget.id));
        setDeleteTarget(null);
      } else {
        toast.error(result.error ?? 'Failed to delete analyst');
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Each analyst runs independently with its own strategy and signal settings.
        </p>
        <Button size="sm" onClick={openCreate} className="gap-1.5 shrink-0">
          <Plus className="h-4 w-4" />
          New Analyst
        </Button>
      </div>

      {/* Empty state */}
      {configs.length === 0 && (
        <Card className="border-border border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm font-medium text-foreground mb-1">No analysts yet</p>
            <p className="text-xs text-muted-foreground mb-4">
              Create your first analyst to start running autonomous research.
            </p>
            <Button size="sm" onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Analyst
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Analyst cards grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {configs.map((config) => (
          <AnalystCard
            key={config.id}
            config={config}
            onEdit={() => openEdit(config)}
            onDelete={() => setDeleteTarget(config)}
            onToggle={(enabled) => handleToggle(config.id, enabled)}
          />
        ))}
      </div>

      {/* Create / Edit Sheet — key forces remount to reset form state */}
      <AnalystFormSheet
        key={sheetKey}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editing={editingConfig}
        onSuccess={handleSheetSuccess}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete analyst?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This cannot be
              undone. Past research runs from this analyst will be preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete Analyst'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
