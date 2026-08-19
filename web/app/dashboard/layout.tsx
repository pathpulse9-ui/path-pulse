import { Sidebar } from '../components/dashboard/Sidebar';
import { TopBar } from '../components/dashboard/TopBar';
import { PageActionsProvider } from '../components/dashboard/PageActions';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#F5F5F5]">
      <Sidebar />
      <PageActionsProvider>
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar />
          <main className="flex-1 px-6 pb-10">{children}</main>
        </div>
      </PageActionsProvider>
    </div>
  );
}
