/**
 * Loading states (design system §12): the shape of the page that's coming,
 * not a spinner, so nothing jumps when it lands. Used by each section's
 * `loading.tsx`; the app shell around it stays put and interactive.
 *
 * One status for the whole skeleton (not one per bar), so a screen reader
 * hears "Loading" once.
 */
const Bar = ({ className = "" }: { className?: string }) => <span aria-hidden="true" className={`hu-skel block ${className}`} />;

const Card = ({ className = "", lines = 3 }: { className?: string; lines?: number }) => (
  <span aria-hidden="true" className={`block bg-paper border border-hairline rounded-md p-5 ${className}`}>
    <Bar className="h-3 w-24" />
    <span className="mt-4 flex flex-col gap-2.5">
      {Array.from({ length: lines }).map((_, i) => <Bar key={i} className={`h-3.5 ${i === lines - 1 ? "w-3/5" : "w-full"}`} />)}
    </span>
  </span>
);

const Heading = () => (
  <span aria-hidden="true" className="flex flex-col gap-3">
    <Bar className="h-3 w-28" />
    <Bar className="h-9 w-[min(420px,80%)] !rounded-sm" />
    <Bar className="h-4 w-[min(560px,95%)]" />
  </span>
);

export function PageSkeleton({ variant = "doc", label = "Loading", contained = false }: {
  /** home: Brand home's two columns · doc: one reading column · split: the composer · canvas: the editor. */
  variant?: "home" | "doc" | "split" | "canvas";
  label?: string;
  /** Inside a layout that already sets the column (Settings): flow, don't fill. */
  contained?: boolean;
}) {
  if (contained) {
    return (
      <div role="status" aria-label={label} aria-busy="true" className="flex flex-col gap-8 fade-in">
        <Heading />
        <Card className="h-[160px]" lines={3} />
        <Card className="h-[200px]" lines={4} />
      </div>
    );
  }
  const body =
    variant === "home" ? (
      <div className="max-w-[1180px] mx-auto px-5 min-[900px]:px-8 pt-8 pb-16 flex flex-col gap-8">
        <Heading />
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
          <div className="flex flex-col gap-4 lg:order-2"><Card className="h-[300px]" lines={4} /><Card lines={2} /></div>
          <div className="flex flex-col gap-6 lg:order-1">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <Card key={i} className="h-[170px]" />)}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[0, 1, 2, 3].map((i) => <Card key={i} className="h-[180px]" lines={3} />)}</div>
          </div>
        </div>
      </div>
    ) : variant === "split" ? (
      <div className="min-h-full min-[1100px]:grid min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="max-w-[760px] w-full mx-auto px-5 sm:px-8 py-8 flex flex-col gap-5">
          <Heading />
          <span aria-hidden="true" className="block bg-paper border border-hairline rounded-md h-[380px]" />
        </div>
        <div className="border-l border-hairline bg-paper px-6 py-6 hidden min-[1100px]:flex flex-col gap-4">
          <Bar className="h-3 w-28" />
          <span className="flex items-center gap-3"><Bar className="w-9 h-9 !rounded-full" /><Bar className="h-4 w-32" /></span>
          <Bar className="h-6 w-full" />
        </div>
      </div>
    ) : variant === "canvas" ? (
      <div className="absolute inset-0 canvas-dots flex items-start justify-center gap-6 pt-16 px-6">
        {[0, 1, 2].map((i) => <Card key={i} className="w-[240px] h-[300px] hidden sm:block first:block" lines={5} />)}
      </div>
    ) : (
      <div className="max-w-[880px] mx-auto px-5 sm:px-8 py-10 flex flex-col gap-8">
        <Heading />
        <Card className="h-[180px]" lines={3} />
        <Card className="h-[220px]" lines={4} />
      </div>
    );
  return (
    <div role="status" aria-label={label} aria-busy="true" className="absolute inset-0 overflow-hidden fade-in">
      {body}
    </div>
  );
}
