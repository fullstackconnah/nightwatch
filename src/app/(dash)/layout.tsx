import { SideNav } from "@/components/side-nav";
import { dockgeUrl } from "@/lib/config";

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <SideNav dockgeUrl={dockgeUrl()} />
      <main className="pl-52">
        <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
