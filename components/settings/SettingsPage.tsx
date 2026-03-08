'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  saveAgentConfig,
  toggleAutoRun,
  type AgentConfigInput,
} from '@/lib/actions/settings.actions';
import type { AgentConfig } from '@/lib/generated/prisma';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SectionCard({
  title,
  children,
  onSave,
  saving,
}: {
  title: string;
  children: React.ReactNode;
  onSave: () => void;
  saving?: boolean;
}) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">{children}</CardContent>
      <CardFooter className="pt-4">
        <Button size="sm" onClick={onSave} disabled={saving} className="ml-auto">
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Card 1: Research Schedule ────────────────────────────────────────────────

function ResearchScheduleCard({
  config,
  onSaved,
}: {
  config: AgentConfig;
  onSaved: (patch: Partial<AgentConfigInput>) => void;
}) {
  const [autoRun, setAutoRun] = useState(config.enabled);
  const [maxTrades, setMaxTrades] = useState(String(config.maxOpenPositions));
  const [minConfidence, setMinConfidence] = useState(String(config.minConfidence));

  const durations = [
    { id: 'DAY', label: 'Day Trade' },
    { id: 'SWING', label: 'Swing' },
    { id: 'LONG', label: 'Long-term' },
  ];
  const [selectedDurations, setSelectedDurations] = useState<string[]>(
    config.holdDurations.length > 0 ? config.holdDurations : ['SWING']
  );

  const sectors = [
    { id: 'Technology', label: 'Technology' },
    { id: 'Finance', label: 'Finance' },
    { id: 'Healthcare', label: 'Healthcare' },
    { id: 'Energy', label: 'Energy' },
    { id: 'Consumer Discretionary', label: 'Consumer' },
  ];
  const [selectedSectors, setSelectedSectors] = useState<string[]>(config.sectors);

  const [isPending, startTransition] = useTransition();

  const toggleItem = (id: string, current: string[], setter: (v: string[]) => void) => {
    setter(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };

  const handleAutoRunToggle = (checked: boolean) => {
    setAutoRun(checked);
    startTransition(async () => {
      const result = await toggleAutoRun(checked);
      if (result.success) {
        toast.success(checked ? 'Auto-run enabled' : 'Auto-run disabled');
        onSaved({ enabled: checked });
      } else {
        toast.error('Failed to update auto-run');
        setAutoRun(!checked);
      }
    });
  };

  const handleSave = () => {
    startTransition(async () => {
      const patch: Partial<AgentConfigInput> = {
        enabled: autoRun,
        maxOpenPositions: Number(maxTrades),
        minConfidence: Number(minConfidence),
        holdDurations: selectedDurations,
        sectors: selectedSectors,
      };
      const result = await saveAgentConfig({ ...buildFullInput(config), ...patch });
      if (result.success) {
        toast.success('Settings saved');
        onSaved(patch);
      } else {
        toast.error('Failed to save settings');
      }
    });
  };

  return (
    <SectionCard title="Research Schedule" onSave={handleSave} saving={isPending}>
      <SettingRow
        label="Auto-run Research"
        description="Run AI research at 8:00 AM ET on weekdays"
      >
        <Switch checked={autoRun} onCheckedChange={handleAutoRunToggle} disabled={isPending} />
      </SettingRow>

      <SettingRow label="Max Open Positions">
        <Select value={maxTrades} onValueChange={setMaxTrades}>
          <SelectTrigger className="w-20 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['1', '2', '3', '5', '10'].map((v) => (
              <SelectItem key={v} value={v}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Min Confidence Threshold">
        <Select value={minConfidence} onValueChange={setMinConfidence}>
          <SelectTrigger className="w-20 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['60', '65', '70', '75', '80'].map((v) => (
              <SelectItem key={v} value={v}>{v}%</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <div className="py-3">
        <p className="text-sm font-medium text-foreground mb-3">Preferred Hold Durations</p>
        <div className="flex flex-wrap gap-3">
          {durations.map(({ id, label }) => (
            <div key={id} className="flex items-center gap-2">
              <Checkbox
                id={`duration-${id}`}
                checked={selectedDurations.includes(id)}
                onCheckedChange={() => toggleItem(id, selectedDurations, setSelectedDurations)}
              />
              <Label htmlFor={`duration-${id}`} className="text-sm cursor-pointer">
                {label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <div className="py-3">
        <p className="text-sm font-medium text-foreground mb-3">Preferred Sectors</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {sectors.map(({ id, label }) => (
            <div key={id} className="flex items-center gap-2">
              <Checkbox
                id={`sector-${id}`}
                checked={selectedSectors.includes(id)}
                onCheckedChange={() => toggleItem(id, selectedSectors, setSelectedSectors)}
              />
              <Label htmlFor={`sector-${id}`} className="text-sm cursor-pointer">
                {label}
              </Label>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Card 2: Alert Configuration ─────────────────────────────────────────────

function AlertConfigCard({
  config,
  onSaved,
}: {
  config: AgentConfig;
  onSaved: (patch: Partial<AgentConfigInput>) => void;
}) {
  const [emailAlerts, setEmailAlerts] = useState(config.emailAlerts);
  const [weeklyDigest, setWeeklyDigest] = useState(config.weeklyDigestEnabled);
  const [digestEmail, setDigestEmail] = useState(config.digestEmail ?? '');

  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const patch: Partial<AgentConfigInput> = {
        emailAlerts,
        weeklyDigestEnabled: weeklyDigest,
        digestEmail: digestEmail.trim() || null,
      };
      const result = await saveAgentConfig({ ...buildFullInput(config), ...patch });
      if (result.success) {
        toast.success('Alert settings saved');
        onSaved(patch);
      } else {
        toast.error('Failed to save alert settings');
      }
    });
  };

  return (
    <SectionCard title="Alert Configuration" onSave={handleSave} saving={isPending}>
      <SettingRow
        label="Email alerts"
        description="Receive email when trades are placed or closed"
      >
        <Switch checked={emailAlerts} onCheckedChange={setEmailAlerts} />
      </SettingRow>

      <SettingRow
        label="Weekly performance report"
        description="Sunday summary of the past week's activity"
      >
        <Switch checked={weeklyDigest} onCheckedChange={setWeeklyDigest} />
      </SettingRow>

      <SettingRow
        label="Digest email override"
        description="Send digest to a different address (leave blank to use your account email)"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Switch checked={false} disabled className="opacity-40 cursor-not-allowed" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Slack integration coming in M6</p>
          </TooltipContent>
        </Tooltip>
      </SettingRow>

      <div className="py-3">
        <p className="text-sm font-medium text-foreground mb-2">Digest email override</p>
        <p className="text-xs text-muted-foreground mb-3">
          Optional — leave blank to use your account email
        </p>
        <Input
          type="email"
          placeholder="you@example.com"
          value={digestEmail}
          onChange={(e) => setDigestEmail(e.target.value)}
          className="max-w-sm h-8 text-sm"
        />
      </div>
    </SectionCard>
  );
}

// ─── Card 3: Graduation Settings ─────────────────────────────────────────────

function GraduationSettingsCard({
  config,
  onSaved,
}: {
  config: AgentConfig;
  onSaved: (patch: Partial<AgentConfigInput>) => void;
}) {
  const [winRateTarget, setWinRateTarget] = useState(
    String(Math.round(config.graduationWinRate * 100))
  );
  const [minTrades, setMinTrades] = useState(String(config.graduationMinTrades));
  const [maxPositionSize, setMaxPositionSize] = useState(String(config.realMaxPosition));
  const [graduationMode, setGraduationMode] = useState('manual');

  const [isPending, startTransition] = useTransition();

  const handleReset = () => {
    setWinRateTarget('65');
    setMinTrades('50');
    setMaxPositionSize('500');
    setGraduationMode('manual');
    toast.info('Reset to defaults');
  };

  const handleSave = () => {
    startTransition(async () => {
      const patch: Partial<AgentConfigInput> = {
        graduationWinRate: Number(winRateTarget) / 100,
        graduationMinTrades: Number(minTrades),
        realMaxPosition: Number(maxPositionSize),
      };
      const result = await saveAgentConfig({ ...buildFullInput(config), ...patch });
      if (result.success) {
        toast.success('Graduation settings saved');
        onSaved(patch);
      } else {
        toast.error('Failed to save graduation settings');
      }
    });
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">Graduation Settings</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        <SettingRow
          label="Win Rate Threshold"
          description="Minimum win rate required to graduate to real trading"
        >
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              value={winRateTarget}
              onChange={(e) => setWinRateTarget(e.target.value)}
              className="w-16 h-8 text-sm text-right tabular-nums"
              min="50"
              max="90"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </SettingRow>

        <SettingRow
          label="Min Closed Trades"
          description="Minimum number of completed trades before graduation is possible"
        >
          <Input
            type="number"
            value={minTrades}
            onChange={(e) => setMinTrades(e.target.value)}
            className="w-20 h-8 text-sm text-right tabular-nums"
            min="5"
          />
        </SettingRow>

        <SettingRow
          label="Max Position Size (real)"
          description="Maximum per-trade size when trading real money"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              value={maxPositionSize}
              onChange={(e) => setMaxPositionSize(e.target.value)}
              className="w-24 h-8 text-sm text-right tabular-nums"
              min="100"
            />
          </div>
        </SettingRow>

        <div className="py-3">
          <p className="text-sm font-medium text-foreground mb-3">Graduation Approval</p>
          <RadioGroup value={graduationMode} onValueChange={setGraduationMode} className="space-y-2">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="auto" id="mode-auto" />
              <Label htmlFor="mode-auto" className="text-sm cursor-pointer">
                Auto — graduate automatically when thresholds are met
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="manual" id="mode-manual" />
              <Label htmlFor="mode-manual" className="text-sm cursor-pointer">
                Manual — require my approval before going live
              </Label>
            </div>
          </RadioGroup>
        </div>
      </CardContent>
      <CardFooter className="pt-4 flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleReset}
          disabled={isPending}
        >
          Reset to Defaults
        </Button>
        <Button size="sm" onClick={handleSave} disabled={isPending} className="ml-auto">
          {isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a full AgentConfigInput from the current DB config so each card only
 *  needs to override its own fields (avoids wiping unrelated fields on save). */
function buildFullInput(config: AgentConfig): AgentConfigInput {
  return {
    enabled: config.enabled,
    maxOpenPositions: config.maxOpenPositions,
    minConfidence: config.minConfidence,
    holdDurations: config.holdDurations,
    sectors: config.sectors,
    signalTypes: config.signalTypes,
    weeklyDigestEnabled: config.weeklyDigestEnabled,
    digestEmail: config.digestEmail ?? null,
    graduationWinRate: config.graduationWinRate,
    graduationMinTrades: config.graduationMinTrades,
    realMaxPosition: config.realMaxPosition,
    emailAlerts: config.emailAlerts,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SettingsPage({ config: initialConfig }: { config: AgentConfig }) {
  // Keep a client-side mirror of config so each card can pass the latest
  // values to buildFullInput (prevents one card from clobbering another).
  const [config, setConfig] = useState<AgentConfig>(initialConfig);

  const handleSaved = (patch: Partial<AgentConfigInput>) => {
    setConfig((prev) => ({
      ...prev,
      ...patch,
      // map AgentConfigInput keys back to AgentConfig model keys
    } as AgentConfig));
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
      <Separator />
      <ResearchScheduleCard config={config} onSaved={handleSaved} />
      <AlertConfigCard config={config} onSaved={handleSaved} />
      <GraduationSettingsCard config={config} onSaved={handleSaved} />
    </div>
  );
}
