import type { ReactNode } from 'react';
import { Card, CardHeader } from '@/components/ui/primitives';
import { useBrand } from '@/context/BrandContext';

/**
 * A section that has no storage behind it yet.
 *
 * This exists because the alternative was worse: these panels used to render a
 * full form with a Save button that pushed a green "saved" toast and wrote
 * nothing. An operator changed a setting, was told it worked, and the change
 * was gone on the next page load. A section that says plainly "this is not
 * wired up" costs the operator one disappointment; a section that lies costs
 * them a fleet running on settings they think they changed.
 */
export function Unavailable({
  title,
  sub,
  summary,
  covers,
  needs,
}: {
  title: string;
  sub?: string;
  /** One sentence: what is missing, in the operator's terms. */
  summary: ReactNode;
  /** What this section would control once it has somewhere to live. */
  covers: string[];
  /** What has to be built, in developer terms. Shown so the gap is traceable. */
  needs: ReactNode;
}) {
  const { colors } = useBrand();
  return (
    <Card>
      <CardHeader title={title} sub={sub} />
      <div className="card-pad stack" style={{ gap: 'var(--space-lg)' }}>
        <div className="banner" style={{ borderColor: `${colors.warning}55`, background: `${colors.warning}12` }}>
          <div className="banner-bar" style={{ background: colors.warning }} />
          <div>
            <div style={{ fontWeight: 600 }}>Not available yet</div>
            <div className="muted" style={{ marginTop: 4 }}>{summary}</div>
          </div>
        </div>

        <div>
          <div className="section-label">What this will configure</div>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            {covers.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>

        <div>
          <div className="section-label">What it needs</div>
          <div className="muted" style={{ fontSize: 13 }}>{needs}</div>
        </div>
      </div>
    </Card>
  );
}
