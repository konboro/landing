import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { DataProvider } from '@/context/DataContext';
import { AuthProvider } from '@/context/AuthContext';
import { AppShell } from '@/components/layout/AppShell';

import { DashboardPage } from '@/pages/Dashboard';
import { RideVerificationPage } from '@/pages/RideVerification';
import { RidesPage } from '@/pages/Rides';
import { RideDetailPage } from '@/pages/RideDetail';
import { VehiclesPage } from '@/pages/Vehicles';
import { VehicleDetailPage } from '@/pages/VehicleDetail';
import { VehicleLabelPrint } from '@/pages/VehicleLabelPrint';
import { CustomersPage } from '@/pages/Customers';
import { CustomerDetailPage } from '@/pages/CustomerDetail';
import { AnalyticsPage } from '@/pages/Analytics';
import { ZonesPage } from '@/pages/Zones';
import { PricingPage } from '@/pages/Pricing';
import { MarketingPage } from '@/pages/Marketing';
import { FleetMaintenancePage } from '@/pages/FleetMaintenance';
import { FinancePage } from '@/pages/Finance';
import { ContentPage } from '@/pages/Content';
import { TeamPage } from '@/pages/Team';
import { SettingsPage } from '@/pages/Settings';
import { NotFoundPage } from '@/pages/NotFound';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DataProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                {/* standalone printable view (no shell) */}
                <Route path="/vehicles/:id/label" element={<VehicleLabelPrint />} />

                <Route element={<AppShell />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/verification" element={<RideVerificationPage />} />
                  <Route path="/rides" element={<RidesPage />} />
                  <Route path="/rides/:id" element={<RideDetailPage />} />
                  <Route path="/vehicles" element={<VehiclesPage />} />
                  <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/customers/:id" element={<CustomerDetailPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/zones" element={<ZonesPage />} />
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/marketing" element={<MarketingPage />} />
                  <Route path="/fleet" element={<FleetMaintenancePage />} />
                  <Route path="/finance" element={<FinancePage />} />
                  <Route path="/content" element={<ContentPage />} />
                  <Route path="/team" element={<TeamPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/404" element={<NotFoundPage />} />
                  <Route path="*" element={<Navigate to="/404" replace />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </DataProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
