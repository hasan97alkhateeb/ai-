import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { Router } from 'wouter';
import PracticePage from '@/pages/practice';

const root = document.getElementById('root');
if (!root) throw new Error('Practice browser test root element is missing.');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <Router>
      <PracticePage />
    </Router>
  </QueryClientProvider>,
);