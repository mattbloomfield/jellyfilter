import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { Layout } from "./components/Layout";
import { useSetup } from "./hooks/useSetup";
import { Library } from "./pages/Library";
import { ItemDetail } from "./pages/ItemDetail";
import { Preferences } from "./pages/Preferences";
import { Queue } from "./pages/Queue";
import { Setup } from "./pages/Setup";
import { useQuery } from "@tanstack/react-query";
import { fetchLibraryItems } from "./api/jellyfin";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function App() {
  const { isConfigured } = useSetup();

  const { data: items = [] } = useQuery({
    queryKey: ["library"],
    queryFn: fetchLibraryItems,
    enabled: isConfigured,
    staleTime: 5 * 60_000,
  });

  if (!isConfigured) {
    return <Setup />;
  }

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<Library items={items} />} />
          <Route path="/library/:itemId" element={<ItemDetail items={items} />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/preferences" element={<Preferences />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
