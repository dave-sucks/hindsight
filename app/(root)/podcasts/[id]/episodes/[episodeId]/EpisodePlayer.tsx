"use client";

/**
 * Sticky bottom-center audio player for an episode.
 *
 * Layout (left → right):
 *   [Play/Pause]   Title              [Skip-back][Skip-forward]
 *                  ────●───── time / duration
 *
 * Glassy container: backdrop blur over a translucent background. Sits
 * fixed at the bottom of the viewport, centered, capped at 640px wide.
 */

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface Props {
  audioUrl: string;
  title: string;
  /**
   * Duration in seconds, persisted on the Episode row at generation time.
   * Used as a fallback because some browsers report `audio.duration === 0`
   * (or Infinity) for signed-URL MP3s until the full file is downloaded.
   * Without this, the progress bar can't render and seek can't compute.
   */
  initialDurationSec?: number;
}

const SKIP_BACK_SECONDS = 15;
const SKIP_FORWARD_SECONDS = 30;

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function EpisodePlayer({ audioUrl, title, initialDurationSec }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(initialDurationSec ?? 0);

  // Sync audio element events → state. Use initialDurationSec as a fallback
  // — some browsers report duration as 0 or Infinity for streamed MP3s until
  // the full file is downloaded, which breaks both progress and seek.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    // Capture metadata that may have already loaded before this effect ran.
    onMeta();
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, []);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  function skipBack() {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, el.currentTime - SKIP_BACK_SECONDS);
  }

  function skipForward() {
    const el = audioRef.current;
    if (!el) return;
    const next = el.currentTime + SKIP_FORWARD_SECONDS;
    el.currentTime = duration > 0 ? Math.min(duration, next) : next;
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const el = audioRef.current;
    const track = trackRef.current;
    if (!el || !track || duration <= 0) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = pct * duration;
  }

  const progressPct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="sticky bottom-4 z-50 mx-auto w-full sm:w-[640px] max-w-[calc(100%-1rem)] px-2 sm:px-0">
      <div className="flex items-center gap-3 rounded-full bg-background/40 backdrop-blur-2xl shadow-lg pl-1.5 pr-3 py-1.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 active:translate-y-px"
        >
          {playing ? (
            <Pause className="size-5" fill="currentColor" />
          ) : (
            <Play className="size-5 translate-x-px" fill="currentColor" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate mb-1.5">{title}</p>
          <div className="flex items-center gap-2">
            <div
              ref={trackRef}
              onClick={handleSeek}
              className="flex-1 cursor-pointer py-1.5 -my-1.5"
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={current}
            >
              <Progress value={progressPct} />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {formatTime(current)} / {formatTime(duration)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            onClick={skipBack}
            aria-label={`Skip back ${SKIP_BACK_SECONDS} seconds`}
          >
            <RotateCcw />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={skipForward}
            aria-label={`Skip forward ${SKIP_FORWARD_SECONDS} seconds`}
          >
            <RotateCw />
          </Button>
        </div>

        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} src={audioUrl} preload="metadata" hidden />
      </div>
    </div>
  );
}
