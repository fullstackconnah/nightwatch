import { SideNav } from "@/components/side-nav";
import { dockgeUrl } from "@/lib/config";

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <SideNav dockgeUrl={dockgeUrl()} />
      <main className="md:pl-52">
        <div className="mx-auto max-w-7xl px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-6">{children}</div>
      </main>
    </div>
  );
}
