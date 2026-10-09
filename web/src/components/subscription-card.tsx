import { Gauge } from 'lucide-react';
import { Meter, usageTone } from '@/components/meter';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { percent } from '@/lib/format';
import type { RateLimit } from '@/lib/types';

export function SubscriptionCard({ rate }: { rate: Pick<RateLimit, 'status' | 'five_hour' | 'seven_day' | 'resets_at'> | null }) {
  const five = percent(rate?.five_hour);
  const seven = percent(rate?.seven_day);
  const allowed = !rate?.status || String(rate.status).startsWith('allowed');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-muted-foreground" />
          Subscription usage
        </CardTitle>
        <CardDescription>As Claude last reported it during a run.</CardDescription>
        {rate?.status ? (
          <CardAction>
            <Badge variant="outline" className={allowed ? 'border-success/30 text-success' : 'border-destructive/30 text-destructive'}>
              {allowed ? 'allowed' : rate.status}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {rate ? (
          <>
            <Meter
              label="5-hour window"
              detail={five == null ? 'n/a' : `${five}%`}
              value={five ?? 0}
              tone={usageTone(five)}
              hint={rate.resets_at ? `Resets at ${new Date(rate.resets_at * 1000).toLocaleTimeString(undefined, { timeStyle: 'short' })}` : undefined}
            />
            <Meter label="Weekly window" detail={seven == null ? 'n/a' : `${seven}%`} value={seven ?? 0} tone={usageTone(seven)} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No reading yet. Claude reports it while an audit is running.</p>
        )}
      </CardContent>
    </Card>
  );
}
