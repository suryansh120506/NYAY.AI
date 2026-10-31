/**
 * The layer behind a data screen: two soft colour glows (navy top right, deep crimson bottom left) over a dotted
 * measuring grid. Glass cards above it blur this, which is what makes them read as glass. Decorative and static.
 */
export function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(90% 55% at 85% 0%, color-mix(in srgb, var(--color-mesh-navy-b) 46%, transparent), transparent 70%)",
            "radial-gradient(80% 50% at 0% 100%, color-mix(in srgb, var(--color-mesh-crimson-b) 32%, transparent), transparent 72%)",
          ].join(", "),
        }}
      />
      <div className="absolute inset-0 terminal-grid opacity-70" />
    </div>
  );
}
