// Flag-notification icon — the glyph on a stock's work flag.
//
// A speech bubble with a notification dot: "a run has something to say about
// this stock." Hand-rolled outline for now; Dave is supplying the licensed
// HugeIcons ChatNotificationIcon to drop in its place, so the shape lives in
// one file and nothing else needs to change when it does.
//
// Sized by the host, coloured by currentColor — same contract as the lucide
// icons it sits beside.
export function FlagNotificationIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Bubble, with the top-right corner left open for the dot to sit in. */}
      <path d="M14.5 3.2A9.6 9.6 0 0 0 12 2.9c-5 0-9.1 3.3-9.1 7.4 0 2.3 1.3 4.4 3.3 5.8v3.6l3.4-2a10.8 10.8 0 0 0 2.4.3c5 0 9.1-3.3 9.1-7.4 0-.6-.1-1.2-.3-1.8" />
      {/* The three dots the bubble is about. */}
      <circle cx="8.6" cy="10.3" r=".9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="10.3" r=".9" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="10.3" r=".9" fill="currentColor" stroke="none" />
      {/* The notification. */}
      <circle cx="19" cy="5" r="2.6" />
    </svg>
  );
}
