import { UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { SeverityMatrix } from '@/components/severity-matrix';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { findingsHref } from '@/hooks/use-finding-filters';
import type { FindingView } from '@/lib/types';

// Open findings by what they ask of the reader, with a way to the ones involving personal data.
export function KindMatrixCard({ findings, repo, className }: { findings: FindingView[]; repo?: string; className?: string }) {
  const personal = findings.filter((f) => f.personal_data).length;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Open findings by type and severity</CardTitle>
        <CardDescription>What each one asks of you: security weighs a vulnerability, a bug gets fixed, a chore goes to the backlog.</CardDescription>
        {personal ? (
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link to={findingsHref({ repo, pd: '1' })}>
                <UserRound />
                {personal} involve personal data
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {findings.length ? <SeverityMatrix findings={findings} repo={repo} by="kind" /> : <p className="text-sm text-muted-foreground">No open findings.</p>}
      </CardContent>
    </Card>
  );
}
