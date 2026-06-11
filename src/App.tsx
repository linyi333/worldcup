import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LangProvider } from "./lang";
import WorldCupPage from "./WorldCupPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LangProvider>
        <WorldCupPage />
      </LangProvider>
    </QueryClientProvider>
  );
}
