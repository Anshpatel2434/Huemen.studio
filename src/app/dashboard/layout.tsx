import { ToastProvider } from "@/components/ui";

/**
 * The app is a CANVAS EDITOR (Relume-style): the canvas is the main workspace and
 * the modules collapse into the editor's rail. So this layout is a full-bleed
 * pass-through — the editor screen provides its own chrome (top toolbar, rail,
 * chat panel, canvas).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="h-screen w-full overflow-hidden">{children}</div>
    </ToastProvider>
  );
}
