"use client";

import dynamic from "next/dynamic";

const Silk = dynamic(() => import("@/components/ui/silk").then((m) => ({ default: m.Silk })), {
  ssr: false,
});

export function EpisodeAvatar() {
  return (
    <div className="size-12 rounded-xl overflow-hidden shrink-0">
      <Silk speed={3} scale={1} color="#7B7481" noiseIntensity={1.5} rotation={0} />
    </div>
  );
}
