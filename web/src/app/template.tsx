/** Re-mounts on every navigation, so each page fades in (subtle, and off for reduced motion). */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300">
      {children}
    </div>
  );
}
