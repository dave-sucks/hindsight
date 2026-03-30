"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { CONCEPTS, ONBOARDING_STEPS } from "@/lib/education/concepts";
import {
  Bot,
  Radar,
  PlayCircle,
  ArrowLeftRight,
  RotateCcw,
  ArrowRight,
  ArrowLeft,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Visual icons for each step ─────────────────────────────────────────────

const STEP_VISUALS = {
  analyst: Bot,
  intelligence: Radar,
  run: PlayCircle,
  trade: ArrowLeftRight,
  loop: RotateCcw,
} as const;

const STEP_COLORS = {
  analyst: "bg-violet-500/10 text-violet-500",
  intelligence: "bg-blue-500/10 text-blue-500",
  run: "bg-emerald-500/10 text-emerald-500",
  trade: "bg-amber-500/10 text-amber-500",
  loop: "bg-rose-500/10 text-rose-500",
} as const;

// ── Storage key ────────────────────────────────────────────────────────────

const ONBOARDING_KEY = "hindsight-onboarding-complete";

function hasCompletedOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(ONBOARDING_KEY) === "true";
}

function markOnboardingComplete() {
  if (typeof window !== "undefined") {
    localStorage.setItem(ONBOARDING_KEY, "true");
  }
}

// ── Welcome step (step 0) ──────────────────────────────────────────────────

function WelcomeStep() {
  return (
    <div className="flex flex-col items-center text-center py-4 space-y-4">
      <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Bot className="h-7 w-7 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Welcome to Hindsight</h2>
        <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
          AI-powered paper trading. Create autonomous analysts, let them
          research and trade while you watch, and measure real performance.
        </p>
      </div>
      <Separator />
      <div className="grid grid-cols-5 gap-3 w-full pt-1">
        {ONBOARDING_STEPS.map((step, i) => {
          const Visual = STEP_VISUALS[step.visual];
          const color = STEP_COLORS[step.visual];
          return (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center", color)}>
                <Visual className="h-4 w-4" />
              </div>
              <span className="text-[10px] text-muted-foreground text-center leading-tight">
                {step.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Feature step ───────────────────────────────────────────────────────────

function FeatureStep({ stepIndex }: { stepIndex: number }) {
  const step = ONBOARDING_STEPS[stepIndex];
  const Visual = STEP_VISUALS[step.visual];
  const color = STEP_COLORS[step.visual];
  const concept = CONCEPTS[step.concept];

  return (
    <div className="flex flex-col items-center text-center py-4 space-y-4">
      <div className={cn("h-14 w-14 rounded-2xl flex items-center justify-center", color)}>
        <Visual className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{step.title}</h2>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
          {step.description}
        </p>
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-1.5 pt-2">
        {ONBOARDING_STEPS.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === stepIndex
                ? "w-6 bg-foreground"
                : "w-1.5 bg-muted-foreground/30"
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ── Onboarding Dialog ──────────────────────────────────────────────────────

export function OnboardingDialog({
  forceOpen,
  onOpenChange,
}: {
  forceOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0); // 0 = welcome, 1-5 = feature steps

  const totalSteps = ONBOARDING_STEPS.length + 1; // +1 for welcome

  useEffect(() => {
    if (forceOpen !== undefined) {
      setOpen(forceOpen);
      if (forceOpen) setStep(0);
    }
  }, [forceOpen]);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen);
      if (!isOpen) {
        markOnboardingComplete();
        setStep(0);
      }
      onOpenChange?.(isOpen);
    },
    [onOpenChange]
  );

  const next = useCallback(() => {
    if (step < totalSteps - 1) {
      setStep((s: number) => s + 1);
    } else {
      handleOpenChange(false);
    }
  }, [step, totalSteps, handleOpenChange]);

  const prev = useCallback(() => {
    if (step > 0) setStep((s: number) => s - 1);
  }, [step]);

  const isLast = step === totalSteps - 1;
  const isFirst = step === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="sr-only">
          {step === 0 ? "Welcome to Hindsight" : ONBOARDING_STEPS[step - 1]?.title}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Learn how Hindsight works
        </DialogDescription>

        {step === 0 ? <WelcomeStep /> : <FeatureStep stepIndex={step - 1} />}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2">
          {isFirst ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
            >
              Skip
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={prev}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )}
          <Button size="sm" onClick={next}>
            {isLast ? (
              <>
                Get Started
                <Check className="h-4 w-4" />
              </>
            ) : (
              <>
                {isFirst ? "Take the Tour" : "Next"}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
