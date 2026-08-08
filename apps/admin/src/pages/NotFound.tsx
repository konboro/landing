import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/ui/feedback';

export function NotFoundPage() {
  return (
    <div style={{ paddingTop: 60 }}>
      <EmptyState emoji="🧭" title="Page not found" hint="That route doesn't exist." action={<Link className="btn btn-primary" to="/">Back to dashboard</Link>} />
    </div>
  );
}
