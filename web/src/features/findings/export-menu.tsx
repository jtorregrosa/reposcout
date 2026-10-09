import { Download, FileCode2, FileJson, FileText, Fingerprint } from 'lucide-react';
import { toast } from 'sonner';
import { copyText } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { downloadText, timestamp } from '@/lib/download';
import { plural } from '@/lib/format';
import { buildHtmlReport } from '@/lib/report/html';
import { buildMarkdownReport } from '@/lib/report/markdown';
import { buildSarifReport } from '@/lib/report/sarif';
import type { FindingView, RepoView } from '@/lib/types';

// Exports exactly the findings it is given: what the filters show, a selection, or a queue.
export function ExportMenu({
  findings,
  scope,
  repos,
  repoName,
  label = 'Export',
  what = 'in the current view',
  size = 'sm',
}: {
  findings: FindingView[];
  scope: string;
  repos: RepoView[];
  repoName: string | null;
  label?: string;
  what?: string;
  size?: 'sm' | 'default';
}) {
  const base = `reposcout-findings-${repoName ?? 'all'}-${timestamp()}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={!findings.length}>
          <Download />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {plural(findings.length, 'finding')} {what}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            downloadText(`${base}.html`, buildHtmlReport(findings, { scope, repos }), 'text/html;charset=utf-8');
            toast.success('Report downloaded. Open it in a browser; Ctrl+P saves it as a PDF.');
          }}
        >
          <FileCode2 />
          Printable report (HTML)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            downloadText(`${base}.md`, buildMarkdownReport(findings, scope, repos), 'text/markdown;charset=utf-8');
            toast.success('Markdown report downloaded.');
          }}
        >
          <FileText />
          Markdown report
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            downloadText(`${base}.sarif`, buildSarifReport(findings, repos), 'application/sarif+json;charset=utf-8');
            toast.success('SARIF log downloaded, for code scanning or a SARIF viewer.');
          }}
        >
          <FileJson />
          SARIF 2.1.0
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyText(findings.map((f) => f.fingerprint).join('\n'), 'Fingerprints copied')}>
          <Fingerprint />
          Copy fingerprints
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
