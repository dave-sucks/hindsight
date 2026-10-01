// Flame icon — marks the strongest conviction tier.
//
// `currentColor` throughout, so it takes the colour of the badge text it sits
// in and needs no variant of its own. Sized by the host, same contract as the
// lucide icons it sits beside.
export function FlameIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M10.5 2C16.3548 4.50284 12.2336 10.7723 15.4258 11.4404C17.4 11.8532 17.5 9 17.5 9C19.5 11.5 19.5 13.5 19.5 14.5C19.5 18.6421 16.1421 22 12 22C7.85786 22 4.5 18.6421 4.5 14.5C4.5 8.5 10.5 7 10.5 2ZM11 11C9.55426 11.5532 8.5 13.8256 8.5 15C8.5 17.4853 10.067 19.001 12 19.001C13.933 19.001 15.5 16.9863 15.5 14.501C12.3 15.701 11.1667 12.9379 11 11Z"
      />
    </svg>
  );
}
