'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
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
}: {
  title: string;
  children: React.ReactNode;
  onSave: () => void;
}) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">{children}</CardContent>
      <CardFooter className="pt-4">
        <Button size="sm" onClick={onSave} className="ml-auto">
          Save Changes
        </Button>
      </CardFooter>
    </Card>
  );
}

const saveToast = () =>
  toast.info('Settings saved', {
    description: 'Persistence coming in M5',
  });

// ─── Card 1: Research Schedule ────────────────────────────────────────────────

function ResearchScheduleCard() {
  const [autoRun, setAutoRun] = useState(true);
  const [maxTrades, setMaxTrades] = useState('2');
  const [minConfidence, setMinConfidence] = useState('70');

  const durations = [
    { id: 'day', label: 'Day Trade' },
    { id: 'swing', label: 'Swing' },
    { id: 'long', label: 'Long-term' },
  ];
  const [selectedDurations, setSelectedDurations] = useState<string[]>(['swing']);

  const sectors = [
    { id: 'tech', label: 'Technology' },
    { id: 'finance', label: 'Finance' },
    { id: 'healthcare', label: 'Healthcare' },
    { id: 'energy', label: 'Energy' },
    { id: 'consumer', label: 'Consumer' },
  ];
  const [selectedSectors, setSelectedSectors] = useState<string[]>(['tech', 'finance']);

  const toggleItem = (id: string, current: string[], setter: (v: string[]) => void) => {
    setter(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };

  return (
    <SectionCard title="Research Schedule" onSave={saveToast}>
      <SettingRow
        label="Auto-run Research"
        description="Run AI research at 8:00 AM ET on weekdays"
      >
        <Switch checked={autoRun} onCheckedChange={setAutoRun} />
      </SettingRow>

      <SettingRow label="Max Trades per Day">
        <Select value={maxTrades} onValueChange={setMaxTrades}>
          <SelectTrigger className="w-20 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['1', '2', '3', '5'].map((v) => (
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

function AlertConfigCard() {
  const [alerts, setAlerts] = useState({
    newTrade: true,
    targetHit: true,
    stopHit: true,
    tradeClosed: true,
    dailyDigest: false,
    weeklyReport: true,
    urgentSlack: false,
  });

  const toggle = (key: keyof typeof alerts) =>
    setAlerts((prev) => ({ ...prev, [key]: !prev[key] }));

  const alertRows: Array<{ key: keyof typeof alerts; label: string; description?: string; disabled?: boolean }> = [
    { key: 'newTrade', label: 'New trade placed', description: 'When the agent opens a new paper trade' },
    { key: 'targetHit', label: 'Target price hit' },
    { key: 'stopHit', label: 'Stop loss hit' },
    { key: 'tradeClosed', label: 'Trade closed / evaluated' },
    { key: 'dailyDigest', label: 'Daily digest', description: '8 AM summary email' },
    { key: 'weeklyReport', label: 'Weekly performance report', description: 'Sunday summary' },
    { key: 'urgentSlack', label: 'Urgent alerts via Slack', description: 'Coming in M5', disabled: true },
  ];

  return (
    <SectionCard title="Alert Configuration" onSave={saveToast}>
      {alertRows.map(({ key, label, description, disabled }) => (
        <SettingRow key={key} label={label} description={description}>
          {disabled ? (
            <Tooltip>
              <TooltipTrigger>
                <span tabIndex={0}>
                  <Switch checked={false} disabled className="opacity-40 cursor-not-allowed" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Slack integration available in M5</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Switch checked={alerts[key]} onCheckedChange={() => toggle(key)} />
          )}
        </SettingRow>
      ))}

      <div className="py-3">
        <p className="text-sm font-medium text-foreground mb-3">Delivery Channel</p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox id="delivery-email" checked />
            <Label htmlFor="delivery-email" className="text-sm">Email</Label>
          </div>
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-2 opacity-40 cursor-not-allowed">
                <Checkbox id="delivery-slack" disabled />
                <Label htmlFor="delivery-slack" className="text-sm">Slack</Label>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Coming in M5</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Card 3: Graduation Settings ─────────────────────────────────────────────

function GraduationSettingsCard() {
  const [winRateTarget, setWinRateTarget] = useState('65');
  const [minTrades, setMinTrades] = useState('20');
  const [maxPositionSize, setMaxPositionSize] = useState('500');
  const [graduationMode, setGraduationMode] = useState('manual');

  const handleReset = () => {
    setWinRateTarget('65');
    setMinTrades('20');
    setMaxPositionSize('500');
    setGraduationMode('manual');
    toast.info('Reset to defaults');
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">Graduation Settings</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        <SettingRow
          label="Win Rate Threshold"
          description="Minimum win rate required for graduation"
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
          description="Minimum number of completed trades"
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
        >
          Reset to Defaults
        </Button>
        <Button size="sm" onClick={saveToast} className="ml-auto">
          Save Changes
        </Button>
      </CardFooter>
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function SettingsNav() {
  const pathname = usePathname();
  const links = [
    { href: '/settings', label: 'General' },
    { href: '/settings/agent', label: 'Agent Rules' },
  ];
  return (
    <div className="flex gap-1 border-b mb-6">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            pathname === href
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
      <SettingsNav />
      <ResearchScheduleCard />
      <AlertConfigCard />
      <GraduationSettingsCard />
    </div>
  );
}
