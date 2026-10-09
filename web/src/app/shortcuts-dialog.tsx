import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { SHORTCUTS } from '@/lib/shortcuts';

const GROUPS = [...new Set(Object.values(SHORTCUTS).map((s) => s.group))];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Single keys work outside text fields and dialogs.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {GROUPS.map((group) => (
            <section key={group} className="space-y-1.5">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group}</h3>
              <dl className="space-y-1 text-sm">
                {Object.entries(SHORTCUTS)
                  .filter(([, s]) => s.group === group)
                  .map(([id, s]) => (
                    <div key={id} className="flex items-center justify-between gap-4">
                      <dt>{s.label}</dt>
                      <dd>
                        <KbdGroup>
                          {s.keys.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </KbdGroup>
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
