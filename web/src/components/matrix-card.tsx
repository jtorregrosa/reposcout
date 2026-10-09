import { UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { SeverityMatrix } from '@/components/severity-matrix';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSearchParam } from '@/hooks/use-search-param';
import { findingsHref } from '@/lib/findings-view';
import type { MatrixAxis } from '@/lib/selectors';
import type { FindingView } from '@/lib/types';

const AXES = ['kind', 'category'] as const satisfies readonly MatrixAxis[];

const ABOUT: Record<MatrixAxis, string> = {
  kind: 'What each one asks of you: security weighs a vulnerability, a bug gets fixed, a chore goes to the backlog.',
  category: 'Which analyzer found them.',
};

// Open findings by severity, along type or category; every number opens the findings it counts.
export function MatrixCard({ findings, repo = null, className }: { findings: FindingView[]; repo?: string | null; className?: string }) {
  const [axis, setAxis] = useSearchParam('axis', AXES, 'kind');
  const personal = findings.filter((f) => f.personal_data).length;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Open findings by severity</CardTitle>
        <CardDescription>{ABOUT[axis]}</CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={axis}
            onValueChange={(v) => {
              if (v) setAxis(v as MatrixAxis);
            }}
            aria-label="Rows"
          >
            <ToggleGroupItem value="kind">Type</ToggleGroupItem>
            <ToggleGroupItem value="category">Category</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {findings.length ? <SeverityMatrix findings={findings} repo={repo} by={axis} /> : <p className="text-sm text-muted-foreground">No open findings.</p>}
        {personal ? (
          <Button asChild variant="outline" size="sm">
            <Link to={findingsHref({ queue: 'all', statuses: ['open'], personalData: true, repo })}>
              <UserRound />
              {personal} involve personal data
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
