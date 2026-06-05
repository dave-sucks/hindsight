import { Card, CardContent } from '@/components/ui/card';

/**
 * SettingsSection — Linear-style settings group: heading above ONE Card.
 *
 * Pair this with `InfoRow`s as children. Pass `border` on each InfoRow to
 * get the row-divider rhythm — typically `border` on every row except the
 * last:
 *
 *   <SettingsSection title="Account">
 *     <InfoRow label="Name" value={name} />
 *     <InfoRow label="Email" value={email} border={false} />
 *   </SettingsSection>
 */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <Card>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

/**
 * SettingsPageHeader — page-level h1 + tagline. Sits above all sections on
 * each /settings/* route.
 */
export function SettingsPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && (
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  );
}
